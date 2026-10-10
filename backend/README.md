# PTT Backend (starter)
`npm install && cp .env.example .env && npm start`

REST: POST /auth/register, /auth/login; GET/PATCH /me; GET /contacts; GET/POST /channels; POST /channels/:id/join;
POST /invites, DELETE /invites/:code, POST /invites/:code/join; GET /history.
WebSocket: ws://host:3000/ws?token=JWT  (ptt_start / audio / ptt_end, one talker per channel).

In-memory only. TODO: PostgreSQL, Redis pub/sub, WebRTC/SFU, push notifications, rate limiting, location, admin stats.
