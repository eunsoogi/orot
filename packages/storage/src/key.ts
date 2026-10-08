export interface SecureKeyStore {
  getSecret(): Promise<string | null>;
  setSecret(secret: string): Promise<void>;
  /** Distinguishes an interrupted first launch from missing restored storage. */
  getDatabaseInitializationState?(): Promise<'pending' | 'ready' | null>;
  setDatabaseInitializationState?(state: 'pending' | 'ready'): Promise<void>;
}

export type RandomByteSource = (target: Uint8Array) => void;
/** Reports the main database separately from orphaned SQLite sidecars. */
export type DatabaseFileState = 'present' | 'missing' | 'partial';

const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/i;

export class ExistingDatabaseKeyMissingError extends Error {
  readonly code = 'EXISTING_DATABASE_KEY_MISSING';

  constructor() {
    super('The encryption key for initialized storage is missing.');
    this.name = 'ExistingDatabaseKeyMissingError';
  }
}

export class ExistingDatabaseFileMissingError extends Error {
  readonly code = 'EXISTING_DATABASE_FILE_MISSING';

  constructor() {
    super('The database file for an existing encryption key is missing.');
    this.name = 'ExistingDatabaseFileMissingError';
  }
}

export class PartialDatabaseFileSetError extends Error {
  readonly code = 'PARTIAL_DATABASE_FILE_SET';

  constructor() {
    super('SQLite sidecar files exist without the main database file.');
    this.name = 'PartialDatabaseFileSetError';
  }
}

export async function resolveDatabaseKey(
  keyStore: SecureKeyStore,
  randomBytes: RandomByteSource,
  databaseFileState?: () => Promise<DatabaseFileState>,
): Promise<string> {
  const fileState = databaseFileState ? await databaseFileState() : undefined;
  if (fileState === 'partial') throw new PartialDatabaseFileSetError();

  const initializationState = keyStore.getDatabaseInitializationState
    ? await keyStore.getDatabaseInitializationState()
    : null;
  const stored = await keyStore.getSecret();
  if (stored !== null) {
    if (!KEY_PATTERN.test(stored)) {
      throw new Error('The secure storage key is invalid.');
    }
    // A missing main file is retryable only while this device marks first-run initialization pending.
    if (fileState === 'missing' && initializationState !== 'pending') {
      throw new ExistingDatabaseFileMissingError();
    }
    return stored;
  }

  // A restored encrypted database without its original key must stay untouched; a new key cannot recover it.
  if (fileState === 'present' || initializationState === 'ready') {
    throw new ExistingDatabaseKeyMissingError();
  }

  if (databaseFileState) {
    if (!keyStore.getDatabaseInitializationState || !keyStore.setDatabaseInitializationState) {
      throw new Error('Safe database initialization retry state is unavailable.');
    }
    // This marker is device-only in the app so only an interrupted first-run setup can resume creation.
    await keyStore.setDatabaseInitializationState('pending');
    if ((await keyStore.getDatabaseInitializationState()) !== 'pending') {
      throw new Error('The database initialization retry state could not be verified.');
    }
  }

  const bytes = new Uint8Array(KEY_BYTES);
  randomBytes(bytes);
  const generated = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  bytes.fill(0);
  await keyStore.setSecret(generated);
  if ((await keyStore.getSecret()) !== generated) {
    throw new Error('The secure storage key could not be verified.');
  }
  return generated;
}
