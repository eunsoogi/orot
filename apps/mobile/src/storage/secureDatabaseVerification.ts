import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';

/** Probe the already-known database read-only; never create or rotate a key. */
export async function verifyDatabaseRejectsWrongKey(
  name: string,
  key: string,
): Promise<boolean> {
  const wrongKey = (key[0] === '0' ? '1' : '0') + key.slice(1);
  let probe: DB | null = null;
  try {
    probe = open({
      name,
      encryptionKey: wrongKey,
      failOnCreate: true,
      readOnly: true,
    });
    await probe.execute('SELECT count(*) AS schema_count FROM sqlite_master');
    return false;
  } catch {
    return true;
  } finally {
    try {
      await probe?.closeAsync();
    } catch {
      // The wrong-key check must not change the storage result.
    }
  }
}
