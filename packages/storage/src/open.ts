import { resolveDatabaseKey } from './key';
import type { DatabaseFileState } from './key';
import { runMigrations } from './migrations';
import { createRecordRepository } from './repository';
import type { RecordRepository } from './repository';
import type { RandomByteSource, SecureKeyStore } from './key';
import type { SqlDatabase } from './sql';

export interface OpenEncryptedStorageOptions {
  name: string;
  keyStore: SecureKeyStore;
  randomBytes: RandomByteSource;
  openDatabase: (name: string, encryptionKey: string, allowCreate?: boolean) => SqlDatabase;
  databaseFileState?: () => Promise<DatabaseFileState>;
}

export async function openEncryptedStorage(
  options: OpenEncryptedStorageOptions,
): Promise<RecordRepository> {
  const fileState = options.databaseFileState ? await options.databaseFileState() : undefined;
  const key = await resolveDatabaseKey(
    options.keyStore,
    options.randomBytes,
    fileState === undefined ? undefined : async () => fileState,
  );
  // Reuse the checked file state and make SQLite refuse creation whenever a database was expected.
  const allowCreate = fileState === undefined || fileState === 'missing';
  const database = options.openDatabase(options.name, key, allowCreate);
  try {
    await database.execute('SELECT count(*) AS schema_count FROM sqlite_master');
    await runMigrations(database);
    if (options.keyStore.setDatabaseInitializationState) {
      await options.keyStore.setDatabaseInitializationState('ready');
      if (
        options.keyStore.getDatabaseInitializationState &&
        (await options.keyStore.getDatabaseInitializationState()) !== 'ready'
      ) {
        throw new Error('The database initialization state could not be verified.');
      }
    }
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
