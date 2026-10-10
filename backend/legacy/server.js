// PTT backend: REST (auth, contacts, channels, invites, history) + WebSocket PTT relay.
// Storage is in-memory. TODO: swap `db` for PostgreSQL/Redis.
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret';
const id = () => crypto.randomUUID();

const db = {
  users: new Map(),     // id -> {id,name,email,hash,status,workspaceId,role}
  channels: new Map(),  // id -> {id,workspaceId,name,members:Set}
  invites: new Map(),   // code -> {workspaceId,expires,revoked}
  history: [],          // {id,channelId,from,startedAt,durationMs}
};
const online = new Map(); // userId -> ws

const publicUser = (u) => ({ id: u.id, name: u.name, status: u.status, online: online.has(u.id), role: u.role });
const sign = (u) => jwt.sign({ sub: u.id }, SECRET, { expiresIn: '30d' });

function createWorkspaceFor(u) {
  u.workspaceId = id();
  u.role = 'admin';
  const everyone = { id: id(), workspaceId: u.workspaceId, name: 'Everyone', members: new Set([u.id]) };
  db.channels.set(everyone.id, everyone);
}

const app = express();
app.use(cors(), express.json());

const auth = (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = db.users.get(jwt.verify(t, SECRET).sub);
    if (!req.user) throw new Error('no user');
    next();
  } catch { res.status(401).json({ error: 'unauthorized' }); }
};

// ---- Auth ----
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'invalid input' });
  if ([...db.users.values()].some((u) => u.email === email)) return res.status(409).json({ error: 'email taken' });
  const u = { id: id(), name, email, hash: await bcrypt.hash(password, 10), status: 'Available' };
  createWorkspaceFor(u);
  db.users.set(u.id, u);
  res.json({ token: sign(u), user: publicUser(u) });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = [...db.users.values()].find((x) => x.email === email);
  if (!u || !(await bcrypt.compare(password || '', u.hash))) return res.status(401).json({ error: 'bad credentials' });
  res.json({ token: sign(u), user: publicUser(u) });
});

app.get('/me', auth, (req, res) => res.json(publicUser(req.user)));
app.patch('/me', auth, (req, res) => {
  const { name, status } = req.body || {};
  if (name) req.user.name = String(name).slice(0, 60);
  if (status) req.user.status = String(status).slice(0, 120);
  res.json(publicUser(req.user));
});

// ---- Contacts & channels ----
app.get('/contacts', auth, (req, res) =>
  res.json([...db.users.values()].filter((u) => u.workspaceId === req.user.workspaceId && u.id !== req.user.id).map(publicUser)));

app.get('/channels', auth, (req, res) =>
  res.json([...db.channels.values()]
    .filter((c) => c.workspaceId === req.user.workspaceId)
    .map((c) => ({ id: c.id, name: c.name, members: c.members.size, joined: c.members.has(req.user.id) }))));

app.post('/channels', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const c = { id: id(), workspaceId: req.user.workspaceId, name: String(req.body?.name || '').slice(0, 60), members: new Set([req.user.id]) };
  if (!c.name) return res.status(400).json({ error: 'name required' });
  db.channels.set(c.id, c);
  res.json({ id: c.id, name: c.name });
});

app.post('/channels/:id/join', auth, (req, res) => {
  const c = db.channels.get(req.params.id);
  if (!c || c.workspaceId !== req.user.workspaceId) return res.status(404).json({ error: 'not found' });
  c.members.add(req.user.id);
  res.json({ ok: true });
});

// ---- Invites (QR/link, expiry, revoke) ----
app.post('/invites', auth, (req, res) => {
  const code = crypto.randomBytes(6).toString('hex');
  const hours = Math.min(Number(req.body?.expiresInHours) || 48, 720);
  db.invites.set(code, { workspaceId: req.user.workspaceId, expires: Date.now() + hours * 3600e3, revoked: false });
  res.json({ code, link: `https://example.com/invite/${code}` }); // TODO: real domain / deep link
});
app.delete('/invites/:code', auth, (req, res) => {
  const inv = db.invites.get(req.params.code);
  if (inv && inv.workspaceId === req.user.workspaceId) inv.revoked = true;
  res.json({ ok: true });
});
app.post('/invites/:code/join', auth, (req, res) => {
  const inv = db.invites.get(req.params.code);
  if (!inv || inv.revoked || inv.expires < Date.now()) return res.status(410).json({ error: 'invite invalid' });
  req.user.workspaceId = inv.workspaceId;
  req.user.role = 'member';
  for (const c of db.channels.values()) if (c.workspaceId === inv.workspaceId && c.name === 'Everyone') c.members.add(req.user.id);
  res.json({ ok: true });
});

app.get('/history', auth, (req, res) =>
  res.json(db.history.filter((h) => db.channels.get(h.channelId)?.workspaceId === req.user.workspaceId).slice(-100).reverse()));

// ---- WebSocket PTT relay ----
// Client -> server JSON: {type:'ptt_start',channelId} | {type:'audio',channelId,data:<base64 opus>} | {type:'ptt_end',channelId}
// Server -> clients: same shapes plus {from}. One talker per channel (floor control).
const floor = new Map(); // channelId -> {userId,startedAt}
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const sendTo = (c, userId, msg, exceptSelf = true) => {
  for (const m of c.members) {
    if (exceptSelf && m === userId) continue;
    const s = online.get(m);
    if (s && s.readyState === 1) s.send(JSON.stringify(msg));
  }
};

wss.on('connection', (ws, req) => {
  let user;
  try {
    const t = new URL(req.url, 'http://x').searchParams.get('token');
    user = db.users.get(jwt.verify(t, SECRET).sub);
    if (!user) throw new Error();
  } catch { return ws.close(4401, 'unauthorized'); }

  online.set(user.id, ws);
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const c = db.channels.get(m.channelId);
    if (!c || !c.members.has(user.id)) return;
    const f = floor.get(c.id);
    if (m.type === 'ptt_start') {
      if (f && f.userId !== user.id) return ws.send(JSON.stringify({ type: 'busy', channelId: c.id }));
      floor.set(c.id, { userId: user.id, startedAt: Date.now() });
      sendTo(c, user.id, { type: 'ptt_start', channelId: c.id, from: user.id });
    } else if (m.type === 'audio' && f?.userId === user.id && typeof m.data === 'string' && m.data.length < 65536) {
      sendTo(c, user.id, { type: 'audio', channelId: c.id, from: user.id, data: m.data });
    } else if (m.type === 'ptt_end' && f?.userId === user.id) {
      floor.delete(c.id);
      db.history.push({ id: id(), channelId: c.id, from: user.id, startedAt: f.startedAt, durationMs: Date.now() - f.startedAt });
      sendTo(c, user.id, { type: 'ptt_end', channelId: c.id, from: user.id });
    }
  });
  ws.on('close', () => {
    online.delete(user.id);
    for (const [cid, f] of floor) if (f.userId === user.id) floor.delete(cid);
  });
});

server.listen(PORT, () => console.log(`PTT backend on :${PORT}`));
