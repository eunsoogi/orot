export interface SecureKeyStore {
  getSecret(): Promise<string | null>;
  setSecret(secret: string): Promise<void>;
}

export type RandomByteSource = (target: Uint8Array) => void;

const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/i;

export class ExistingDatabaseKeyMissingError extends Error {
  readonly code = 'EXISTING_DATABASE_KEY_MISSING';

  constructor() {
    super('The encryption key for an existing database is missing.');
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

export async function resolveDatabaseKey(
  keyStore: SecureKeyStore,
  randomBytes: RandomByteSource,
  databaseExists?: () => Promise<boolean>,
): Promise<string> {
  const stored = await keyStore.getSecret();
  if (stored !== null) {
    if (!KEY_PATTERN.test(stored)) {
      throw new Error('The secure storage key is invalid.');
    }
    // A restored key without its database may be a partial restore; do not create an empty replacement database.
    if (databaseExists && !(await databaseExists())) {
      throw new ExistingDatabaseFileMissingError();
    }
    return stored;
  }

  // A restored encrypted database without its original key must stay untouched; a new key cannot recover it.
  if (databaseExists && (await databaseExists())) {
    throw new ExistingDatabaseKeyMissingError();
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
