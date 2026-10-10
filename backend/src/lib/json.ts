/**
 * JSON is stored in portable TEXT/String columns (see schema.prisma notes).
 * These helpers keep the JSON-string <-> structured boundary in one place.
 */

export function serializeJson(value: unknown): string {
  return value === undefined || value === null ? '' : JSON.stringify(value);
}

export function deserializeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export type PermissionList = string[];

export function serializePermissions(value: PermissionList | undefined): string {
  return serializeJson(value ?? []);
}

export function parsePermissions(raw: unknown): PermissionList {
  return deserializeJson<PermissionList>(raw, []);
}

export function parseSettings<T extends Record<string, unknown>>(raw: unknown): T {
  return deserializeJson<T>(raw, {} as T);
}

export function parseAuditData(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}