import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  addContactBody,
  blockBody,
  contactParams,
  publicStatusBody,
  updateContactBody,
  updateProfileBody,
  userParams,
} from './schema.js';
import { usersService } from './service.js';

export async function userRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const catalog = { tags: ['users'], security: [{ bearerAuth: [] }] as const };

  // --- Profile -------------------------------------------------------------
  typed.get('/users/me', { schema: { ...catalog, summary: 'My profile' } }, async (req) => {
    const actor = req.requireAuth();
    return usersService.profile(actor.userId, actor.userId);
  });

  typed.patch('/users/me', { schema: { ...catalog, summary: 'Update profile / presence / ghost mode', body: updateProfileBody } }, async (req) =>
    usersService.updateProfile(req.requireAuth().userId, req.body as unknown as Record<string, unknown>),
  );

  typed.get('/users/:userId', { schema: { ...catalog, summary: 'Public profile (block-aware)', params: userParams } }, async (req) => {
    const actor = req.requireAuth();
    return usersService.profile(req.params.userId, actor.userId);
  });

  typed.patch('/users/me/status', { schema: { ...catalog, summary: 'Set my presence status', body: publicStatusBody } }, async (req) =>
    usersService.updateStatus(req.requireAuth().userId, req.body),
  );

  // --- Contacts -------------------------------------------------------------
  typed.get('/contacts', { schema: { ...catalog, summary: 'Contact list with live presence' } }, async (req) =>
    usersService.listContacts(req.requireAuth().userId),
  );

  typed.post('/contacts', { schema: { ...catalog, summary: 'Add a contact', body: addContactBody } }, async (req) =>
    usersService.addContact(req.requireAuth().userId, req.body),
  );

  typed.patch('/contacts/:contactId', { schema: { ...catalog, summary: 'Edit nickname / favorite', params: contactParams, body: updateContactBody } }, async (req) =>
    usersService.updateContact(req.requireAuth().userId, req.params.contactId, req.body),
  );

  typed.delete('/contacts/:contactId', { schema: { ...catalog, summary: 'Remove a contact', params: contactParams } }, async (req) =>
    usersService.removeContact(req.requireAuth().userId, req.params.contactId),
  );

  // --- Blocks ----------------------------------------------------------------
  typed.get('/blocks', { schema: { ...catalog, summary: 'Users I blocked' } }, async (req) =>
    usersService.listBlocks(req.requireAuth().userId),
  );

  typed.post('/blocks', { schema: { ...catalog, summary: 'Block a user', body: blockBody } }, async (req) =>
    usersService.blockUser(req.requireAuth().userId, req.body.userId),
  );

  typed.delete('/blocks/:userId', { schema: { ...catalog, summary: 'Unblock a user', params: userParams } }, async (req) =>
    usersService.unblockUser(req.requireAuth().userId, req.params.userId),
  );

  return app;
}