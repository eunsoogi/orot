import { resolveDatabaseKey } from './key';
import { runMigrations } from './migrations';
import { createRecordRepository } from './repository';
import type { RecordRepository } from './repository';
import type { RandomByteSource, SecureKeyStore } from './key';
import type { SqlDatabase } from './sql';

export interface OpenEncryptedStorageOptions {
  name: string;
  keyStore: SecureKeyStore;
  randomBytes: RandomByteSource;
  openDatabase: (name: string, encryptionKey: string) => SqlDatabase;
  databaseExists?: () => Promise<boolean>;
}

export async function openEncryptedStorage(
  options: OpenEncryptedStorageOptions,
): Promise<RecordRepository> {
  const key = await resolveDatabaseKey(
    options.keyStore,
    options.randomBytes,
    options.databaseExists,
  );
  const database = options.openDatabase(options.name, key);
  try {
    await database.execute('SELECT count(*) AS schema_count FROM sqlite_master');
    await runMigrations(database);
    return createRecordRepository(database);
  } catch (error) {
    try {
      await database.closeAsync?.();
    } catch {
      // Preserve the initialization failure.
    }
    throw error;
  }
}
