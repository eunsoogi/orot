import { IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';
import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { NativeModules } from 'react-native';
import {
  createAppointmentRepository,
  openEncryptedStorage,
  resolveDatabaseKey,
} from '@orot/storage';
import type {
  AppointmentRepository,
  RecordRepository,
  SqlDatabase,
} from '@orot/storage';
import type { DB } from '@op-engineering/op-sqlite';
import {
  getDatabaseFileState,
  isDatabaseKeyBackupEligible,
  migrateDatabaseKeyForBackup,
} from '../backup/nativeBackupMigration';
import { formatStorageOpenDiagnostic } from './storageDiagnostics';

const DATABASE_NAME = 'orot-secure.db';
const KEYCHAIN_SERVICE = 'com.orot.mobile.database-encryption-key.v1';
const KEYCHAIN_ACCOUNT = 'database';
const INITIALIZATION_SERVICE = 'com.orot.mobile.database-initialization.v1';
const INITIALIZATION_ACCOUNT = 'state';

function shouldLogStorageDiagnostics(): boolean {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const settings =
    settingsManager?.settings ?? settingsManager?.getConstants?.().settings;
  return settings?.OROT_STORAGE_DIAGNOSTICS === 'enabled';
}

const keyStore = {
  async getSecret() {
    const credentials = await getGenericPassword({ service: KEYCHAIN_SERVICE });
    return credentials === false ? null : credentials.password;
  },
  async setSecret(secret: string) {
    const result = await setGenericPassword(KEYCHAIN_ACCOUNT, secret, {
      service: KEYCHAIN_SERVICE,
      accessible: ACCESSIBLE.WHEN_UNLOCKED,
    });
    if (result === false) {
      throw new Error('The database key could not be saved to Keychain.');
    }
  },
  async getDatabaseInitializationState() {
    const state = await getGenericPassword({ service: INITIALIZATION_SERVICE });
    if (state === false) return null;
    if (state.username !== INITIALIZATION_ACCOUNT) {
      throw new Error('The database initialization state is invalid.');
    }
    if (state.password !== 'pending' && state.password !== 'ready') {
      throw new Error('The database initialization state is invalid.');
    }
    return state.password;
  },
  async setDatabaseInitializationState(state: 'pending' | 'ready') {
    // Device-only state prevents a restored key from inheriting permission to create a missing database.
    const result = await setGenericPassword(INITIALIZATION_ACCOUNT, state, {
      service: INITIALIZATION_SERVICE,
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (result === false) {
      throw new Error('The database initialization state could not be saved.');
    }
  },
};

function fillSecureRandomBytes(target: Uint8Array): void {
  const source = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: <T extends ArrayBufferView>(value: T) => T };
    }
  ).crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('A secure random source is unavailable.');
  }
  source.getRandomValues(target);
}

let database: DB | null = null;
let opening: Promise<RecordRepository> | null = null;

export function openLocalStorage(): Promise<RecordRepository> {
  if (!isSQLCipher()) {
    return Promise.reject(
      new Error('The native SQLite build does not include SQLCipher.'),
    );
  }
  if (!opening) {
    opening = (async () => {
      // If eligibility migration fails, retain the existing key path so the current device can still read its database.
      try {
        await migrateDatabaseKeyForBackup();
      } catch {
        // BackupStatusRecovery retries and reports this without rotating the SQLCipher key.
      }
      return openEncryptedStorage({
        name: DATABASE_NAME,
        keyStore,
        randomBytes: fillSecureRandomBytes,
        databaseFileState: () =>
          getDatabaseFileState(DATABASE_NAME, IOS_LIBRARY_PATH),
        openDatabase(name, encryptionKey, allowCreate = true) {
          database = open({
            name,
            location: IOS_LIBRARY_PATH,
            encryptionKey,
            failOnCreate: !allowCreate,
          });
          return database;
        },
      });
    })().catch(error => {
      // The smoke probe opts in so a storage failure is diagnosable without exposing details in normal app launches.
      if (shouldLogStorageDiagnostics()) {
        console.error(
          'Encrypted storage open failed:',
          formatStorageOpenDiagnostic(error),
        );
      }
      opening = null;
      database = null;
      throw error;
    });
  }
  return opening;
}

/** Gives the agent-memory adapter access to the existing encrypted connection without exposing close/delete. */
export async function openLocalAgentMemoryDatabase(): Promise<SqlDatabase> {
  await openLocalStorage();
  if (!database) throw new Error('The encrypted database is not open.');
  const encryptedDatabase = database;
  return {
    execute: (query, parameters) =>
      encryptedDatabase.execute(query, parameters),
    transaction: operation => encryptedDatabase.transaction(operation),
  };
}

export async function openLocalAppointmentRepository(): Promise<AppointmentRepository> {
  const records = await openLocalStorage();
  if (!database) throw new Error('The encrypted database is not open.');
  return createAppointmentRepository(records, database);
}

export async function hasDatabaseKey(): Promise<boolean> {
  return (await keyStore.getSecret()) !== null;
}

export async function prepareDatabaseForBackup(): Promise<void> {
  await openLocalStorage();
  await migrateDatabaseKeyForBackup();
  if (!database) throw new Error('The encrypted database is not open.');
  await database.execute('SELECT count(*) AS schema_count FROM sqlite_master');
  if (!(await isDatabaseKeyBackupEligible())) {
    throw new Error(
      'The database key is not eligible for encrypted device restore.',
    );
  }
}

export async function getCipherVersion(): Promise<string | null> {
  if (!database) throw new Error('The database is not open.');
  const result = await database.execute('PRAGMA cipher_version');
  const value = result.rows[0]?.cipher_version;
  return typeof value === 'string' ? value : null;
}

export async function verifyWrongKeyRejected(): Promise<boolean> {
  const credentials = await getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (credentials === false) return false;
  const key = credentials.password;
  const wrongKey = (key[0] === '0' ? '1' : '0') + key.slice(1);
  let probe: DB | null = null;
  try {
    probe = open({
      name: DATABASE_NAME,
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

export async function prepareLegacyStorageForE2e(
  record: object,
): Promise<void> {
  if (!isSQLCipher())
    throw new Error('The native SQLite build does not include SQLCipher.');
  const key = await resolveDatabaseKey(keyStore, fillSecureRandomBytes, () =>
    getDatabaseFileState(DATABASE_NAME, IOS_LIBRARY_PATH),
  );
  const legacyDatabase = open({
    name: DATABASE_NAME,
    location: IOS_LIBRARY_PATH,
    encryptionKey: key,
  });
  await legacyDatabase.execute(
    'CREATE TABLE records (record_type TEXT NOT NULL, payload_json TEXT NOT NULL)',
  );
  await legacyDatabase.execute(
    'INSERT INTO records (record_type, payload_json) VALUES (?, ?)',
    ['source_record', JSON.stringify(record)],
  );
  await legacyDatabase.execute('PRAGMA user_version = 0');
  await legacyDatabase.closeAsync();
}
