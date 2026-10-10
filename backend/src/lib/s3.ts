import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { registerReadinessCheck } from './health-registry.js';

export const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

const DEFAULT_PUT_EXPIRES_SECONDS = 300;
const DEFAULT_GET_EXPIRES_SECONDS = 3600;

function sanitizePrefix(prefix?: string): string | undefined {
  if (!prefix) return undefined;
  const trimmed = prefix.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return undefined;
  return trimmed;
}

function joinKey(parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join('/');
}

export function buildObjectKey(prefix: string | undefined, extension?: string): string {
  const cleanPrefix = sanitizePrefix(prefix);
  const ext = extension ? extension.replace(/^\./, '') : undefined;
  const id = randomUUID();
  return joinKey([cleanPrefix, ext ? `${id}.${ext}` : id]);
}

export async function getPresignedPutUrl(options: {
  key: string;
  contentType?: string;
  expiresInSeconds?: number;
  acl?: 'private' | 'public-read';
}): Promise<{ url: string; method: 'PUT'; key: string; expiresAt: Date }> {
  const expiresIn = Math.max(1, options.expiresInSeconds ?? DEFAULT_PUT_EXPIRES_SECONDS);
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: options.key,
    ...(options.contentType ? { ContentType: options.contentType } : {}),
    ...(options.acl ? { ACL: options.acl } : {}),
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  return { url, method: 'PUT', key: options.key, expiresAt };
}

export async function getPresignedGetUrl(options: {
  key: string;
  expiresInSeconds?: number;
  responseContentType?: string;
  responseContentDisposition?: string;
}): Promise<{ url: string; method: 'GET'; key: string; expiresAt: Date }> {
  const expiresIn = Math.max(1, options.expiresInSeconds ?? DEFAULT_GET_EXPIRES_SECONDS);
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: options.key,
    ...(options.responseContentType ? { ResponseContentType: options.responseContentType } : {}),
    ...(options.responseContentDisposition ? { ResponseContentDisposition: options.responseContentDisposition } : {}),
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  return { url, method: 'GET', key: options.key, expiresAt };
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

registerReadinessCheck('object-storage', async () => {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, detail };
  }
});
