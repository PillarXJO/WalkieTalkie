export type ReadinessCheck = () => Promise<{ ok: boolean; detail?: string }>;

const checks = new Map<string, ReadinessCheck>();

/**
 * Modules register their own readiness probes (database, redis, object storage...)
 * so the health plugin stays dependency-free.
 */
export function registerReadinessCheck(name: string, check: ReadinessCheck): void {
  checks.set(name, check);
}

export function clearReadinessChecks(): void {
  checks.clear();
}

export async function runReadinessChecks(): Promise<{
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
}> {
  const results: Record<string, { ok: boolean; detail?: string }> = {};
  await Promise.all(
    [...checks.entries()].map(async ([name, check]) => {
      try {
        results[name] = await check();
      } catch (err) {
        results[name] = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return { ok: Object.values(results).every((r) => r.ok), checks: results };
}
