import {
  ExistingDatabaseFileMissingError,
  ExistingDatabaseKeyMissingError,
  resolveDatabaseKey,
  openEncryptedStorage,
} from '../src';
import type { OpenEncryptedStorageOptions, SecureKeyStore } from '../src';

describe('encrypted database key recovery', () => {
  it('does not create a replacement key or open a restored database when its key is missing', async () => {
    let secret: string | null = null;
    const keyStore: SecureKeyStore = {
      async getSecret() {
        return secret;
      },
      async setSecret(value) {
        secret = value;
      },
    };
    const randomBytes = jest.fn((target: Uint8Array) => target.fill(1));
    const openDatabase = jest.fn(() => {
      throw new Error('An existing encrypted database must not be opened without its key.');
    });
    const options: OpenEncryptedStorageOptions = {
      name: 'orot-secure.db',
      keyStore,
      randomBytes,
      openDatabase,
      async databaseExists() {
        return true;
      },
    };

    // Restoring an encrypted file without its matching key is a recovery state, never a first-run state.
    await expect(openEncryptedStorage(options)).rejects.toBeInstanceOf(
      ExistingDatabaseKeyMissingError,
    );
    expect(randomBytes).not.toHaveBeenCalled();
    expect(secret).toBeNull();
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('generates a key only when the database file is absent', async () => {
    let secret: string | null = null;
    const keyStore: SecureKeyStore = {
      async getSecret() {
        return secret;
      },
      async setSecret(value) {
        secret = value;
      },
    };
    const key = await resolveDatabaseKey(
      keyStore,
      (target) => target.fill(0x2a),
      async () => false,
    );

    expect(key).toBe('2a'.repeat(32));
    expect(secret).toBe(key);
  });

  it('does not create an empty database when a restored key exists without its database file', async () => {
    const secret = '4a'.repeat(32);
    const keyStore: SecureKeyStore = {
      async getSecret() {
        return secret;
      },
      async setSecret() {
        throw new Error('The existing key must not be replaced.');
      },
    };
    const randomBytes = jest.fn((target: Uint8Array) => target.fill(1));
    const openDatabase = jest.fn(() => {
      throw new Error('A partial restore must not create an empty database.');
    });

    await expect(
      openEncryptedStorage({
        name: 'orot-secure.db',
        keyStore,
        randomBytes,
        openDatabase,
        async databaseExists() {
          return false;
        },
      }),
    ).rejects.toBeInstanceOf(ExistingDatabaseFileMissingError);
    expect(randomBytes).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('fails closed if the database existence check is unavailable', async () => {
    let secret: string | null = null;
    const keyStore: SecureKeyStore = {
      async getSecret() {
        return secret;
      },
      async setSecret(value) {
        secret = value;
      },
    };
    const randomBytes = jest.fn((target: Uint8Array) => target.fill(1));

    await expect(
      resolveDatabaseKey(keyStore, randomBytes, async () => {
        throw new Error('Database file inspection failed.');
      }),
    ).rejects.toThrow('Database file inspection failed.');
    expect(randomBytes).not.toHaveBeenCalled();
    expect(secret).toBeNull();
  });
});
