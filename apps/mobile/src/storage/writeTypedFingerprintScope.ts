import type { SqlExecutor } from '@orot/storage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { retainedRecordKey } from './retainedRecordRows';

type TypedKind = 'health_observation' | 'source_record';
type Entry = {
  readonly serialized: string;
  readonly digest: string;
  readonly bytes: number;
};
type Calculation = (
  key: { readonly kind: TypedKind; readonly id: string },
  freshSerialized: string,
) => string;

const maxEntries = 256;
const maxBytes = 256 * 1024;
const scopes = new WeakMap<SqlExecutor, Calculation>();

/** Only canonical computation is shared, never a source read or authority.
 * Keep exact, bounded temporary bytes only during the owning final validation. */
export async function withWriteTypedFingerprints<T>(
  tx: SqlExecutor,
  validate: () => Promise<T>,
): Promise<T> {
  if (scopes.has(tx)) return validate();
  const memo = new Map<string, Entry>();
  let retained = 0;
  scopes.set(tx, (record, serialized) => {
    const key = retainedRecordKey(record);
    const previous = memo.get(key);
    if (previous?.serialized === serialized) return previous.digest;
    const digest = fingerprint(JSON.parse(serialized));
    if (previous) {
      memo.delete(key);
      retained -= previous.bytes;
    }
    // Count UTF-16 storage conservatively, including the key and digest.
    const bytes = 2 * (key.length + serialized.length + digest.length);
    if (memo.size < maxEntries && bytes <= maxBytes - retained) {
      memo.set(key, { serialized, digest, bytes });
      retained += bytes;
    }
    return digest;
  });
  try {
    return await validate();
  } finally {
    scopes.delete(tx);
    memo.clear();
  }
}

/** Call only after loading the current typed row from the supplied executor. */
export function writeTypedFingerprint(
  tx: SqlExecutor,
  record: { readonly kind: string; readonly id: string },
  freshSerialized: string,
): string | undefined {
  if (record.kind !== 'health_observation' && record.kind !== 'source_record')
    return undefined;
  return scopes.get(tx)?.(
    { id: record.id, kind: record.kind },
    freshSerialized,
  );
}
