import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildObjectKey, getPresignedGetUrl, getPresignedPutUrl } from '../../lib/s3.js';
import { mediaGetParams, mediaGetQuery, mediaUploadParams } from './schema.js';

export async function mediaRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const catalog = { tags: ['media'], security: [{ bearerAuth: [] }] as const };

  typed.get(
    '/media/upload-url',
    { schema: { ...catalog, summary: 'Get a presigned PUT URL for uploading media', querystring: mediaUploadParams } },
    async (req) => {
      const auth = req.requireAuth();
      const prefix = req.query.prefix ?? (req.query.type ? `${req.query.type}/users/${auth.userId}` : `uploads/users/${auth.userId}`);
      const key = buildObjectKey(prefix, req.query.extension);
      const result = await getPresignedPutUrl({
        key,
        contentType: req.query.contentType,
        expiresInSeconds: req.query.expiresInSeconds,
        acl: req.query.acl,
      });
      return {
        uploadUrl: result.url,
        key: result.key,
        method: result.method,
        expiresAt: result.expiresAt,
        bucket: process.env.S3_BUCKET,
      };
    },
  );

  typed.get(
    '/media/:key/get-url',
    { schema: { ...catalog, summary: 'Get a presigned GET URL for media', params: mediaGetParams, querystring: mediaGetQuery } },
    async (req, reply) => {
      req.requireAuth();
      try {
        const result = await getPresignedGetUrl({
          key: req.params.key,
          expiresInSeconds: req.query.expiresInSeconds,
          responseContentType: req.query.responseContentType,
          responseContentDisposition: req.query.responseContentDisposition,
        });
        return {
          downloadUrl: result.url,
          key: result.key,
          method: result.method,
          expiresAt: result.expiresAt,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: { message, code: 'MEDIA_PRESIGN_FAILED' } });
      }
    },
  );

  return app;
}