import { auditRepo, type AuditEntry } from '../repositories/audit.repo.js';
import type { Db } from '../repositories/types.js';

/**
 * Fire-and-forget audit logging. Auditing must never break the primary
 * operation, so any failure is swallowed (the repo already runs in the caller's
 * transaction when `db` is supplied).
 */
export async function recordAudit(entry: AuditEntry, db?: Db): Promise<void> {
  try {
    await auditRepo.log(entry, db);
  } catch {
    // no-op: never surface audit failures to the caller
  }
}
