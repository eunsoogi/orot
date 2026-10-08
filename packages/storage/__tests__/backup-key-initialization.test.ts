import {
  ExistingDatabaseKeyMissingError,
  PartialDatabaseFileSetError,
  openEncryptedStorage,
} from '../src';
import type { OpenEncryptedStorageOptions, SecureKeyStore } from '../src';
import { createDatabase } from './sourceEvidenceTestSupport';

describe('database initialization restore boundary', () => {
  it('opens an existing database with SQLite creation disabled', async () => {
    const initialization = { value: null as 'pending' | 'ready' | null };
    const keyStore: SecureKeyStore = {
      async getSecret() {
        return '3a'.repeat(32);
      },
      async setSecret() {
        throw new Error('The existing SQLCipher key must be preserved.');
      },
      async getDatabaseInitializationState() {
        return initialization.value;
      },
      async setDatabaseInitializationState(value) {
        initialization.value = value;
      },
    };
    const database = createDatabase();
    const openDatabase = jest.fn((_name: string, _key: string, allowCreate: boolean) => {
      expect(allowCreate).toBe(false);
      return database;
    });

    await openEncryptedStorage({
      name: 'orot-secure.db',
      keyStore,
      randomBytes: jest.fn((target: Uint8Array) => target.fill(1)),
      openDatabase,
      async databaseFileState() {
        return 'present';
      },
    });

    expect(openDatabase).toHaveBeenCalledTimes(1);
    await database.closeAsync?.();
  });

  it.each([
    ['without a key', null],
    ['with a key', '4a'.repeat(32)],
  ])('rejects an orphaned SQLite sidecar %s', async (_label, secret) => {
    let storedSecret = secret;
    const keyStore: SecureKeyStore = {
      async getSecret() {
        return storedSecret;
      },
      async setSecret(value) {
        storedSecret = value;
      },
    };
    const randomBytes = jest.fn((target: Uint8Array) => target.fill(1));
    const openDatabase = jest.fn(() => {
      throw new Error('An orphaned sidecar must never open or create a database.');
    });
    const options: OpenEncryptedStorageOptions = {
      name: 'orot-secure.db',
      keyStore,
      randomBytes,
      openDatabase,
      async databaseFileState() {
        return 'partial';
      },
    };

    await expect(openEncryptedStorage(options)).rejects.toBeInstanceOf(PartialDatabaseFileSetError);
    expect(randomBytes).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
    expect(storedSecret).toBe(secret);
  });

  it('does not create a key when the device-only marker says storage was initialized', async () => {
    const keyStore: SecureKeyStore = {
      async getSecret() {
        return null;
      },
      async setSecret() {
        throw new Error('A replacement key must not be stored.');
      },
      async getDatabaseInitializationState() {
        return 'ready';
      },
      async setDatabaseInitializationState() {
        throw new Error('The existing initialization state must not change.');
      },
    };
    const randomBytes = jest.fn((target: Uint8Array) => target.fill(1));
    const openDatabase = jest.fn(() => {
      throw new Error('A missing initialized database must not be opened.');
    });

    await expect(
      openEncryptedStorage({
        name: 'orot-secure.db',
        keyStore,
        randomBytes,
        openDatabase,
        async databaseFileState() {
          return 'missing';
        },
      }),
    ).rejects.toBeInstanceOf(ExistingDatabaseKeyMissingError);
    expect(randomBytes).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('retries a failed first database creation with the same pending key', async () => {
    let secret: string | null = null;
    let initialization: 'pending' | 'ready' | null = null;
    let databaseExists = false;
    let openAttempts = 0;
    const keyStore = {
      async getSecret() {
        return secret;
      },
      async setSecret(value: string) {
        secret = value;
      },
      async getDatabaseInitializationState() {
        return initialization;
      },
      async setDatabaseInitializationState(value: 'pending' | 'ready') {
        initialization = value;
      },
    };
    const randomBytes = jest.fn((target: Uint8Array) => target.fill(0x2a));
    const database = createDatabase();
    const openDatabase = jest.fn((_name: string, _key: string, allowCreate: boolean) => {
      openAttempts += 1;
      expect(allowCreate).toBe(true);
      if (openAttempts === 1) throw new Error('temporary database creation failure');
      databaseExists = true;
      return database;
    });
    const options: OpenEncryptedStorageOptions = {
      name: 'orot-secure.db',
      keyStore,
      randomBytes,
      openDatabase,
      async databaseFileState() {
        return databaseExists ? 'present' : 'missing';
      },
    };

    await expect(openEncryptedStorage(options)).rejects.toThrow(
      'temporary database creation failure',
    );
    const firstKey = secret;
    const repository = await openEncryptedStorage(options);

    expect(firstKey).toBe('2a'.repeat(32));
    expect(secret).toBe(firstKey);
    expect(initialization).toBe('ready');
    expect(randomBytes).toHaveBeenCalledTimes(1);
    expect(await repository.get('source_record', 'missing')).toBeNull();
    await database.closeAsync?.();
  });
});
