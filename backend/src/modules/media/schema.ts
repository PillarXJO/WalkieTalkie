import { z } from 'zod';

export const mediaUploadParams = z.object({
  /** Target entity for grouping the media (e.g. 'transmissions' or 'attachments') */
  type: z.string().trim().min(1).max(50).optional(),
  /** Optional subfolder/prefix */
  prefix: z.string().trim().max(128).optional(),
  /** MIME type hint for the object (e.g. 'audio/opus', 'audio/webm') */
  contentType: z.string().trim().min(3).max(100).optional(),
  /** File extension without leading dot (e.g. 'opus', 'webm', 'mp3') */
  extension: z.string().trim().min(1).max(20).optional(),
  /** Requested PUT URL expiry in seconds */
  expiresInSeconds: z.coerce.number().int().min(1).max(600).optional(),
  /** Upload ACL (private by default) */
  acl: z.enum(['private', 'public-read']).optional(),
});

export const mediaGetParams = z.object({
  key: z.string().min(1).max(512),
});

export const mediaGetQuery = z.object({
  expiresInSeconds: z.coerce.number().int().min(1).max(3600).optional(),
  responseContentType: z.string().trim().max(100).optional(),
  responseContentDisposition: z.string().trim().max(256).optional(),
});
