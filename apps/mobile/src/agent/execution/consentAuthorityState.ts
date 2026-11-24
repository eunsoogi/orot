/** Non-secret, durable permission generation. Missing/invalid state is never approval. */
export interface ConsentAuthorityState {
  readonly version: 1;
  readonly generation: string;
  readonly status: 'active' | 'suspended' | 'revoked';
}
export function parseConsentAuthorityState(
  value: unknown,
): ConsentAuthorityState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !== 'generation,status,version' ||
    row.version !== 1 ||
    typeof row.generation !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.generation) ||
    !['active', 'suspended', 'revoked'].includes(String(row.status))
  )
    return null;
  return {
    version: 1,
    generation: row.generation,
    status: row.status as ConsentAuthorityState['status'],
  };
}
