import { IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { assertHealthPagination } from './healthPaginationAssertions';

/** Owns one ephemeral encrypted database; it never resets the application's database or Keychain. */
export async function runHealthPaginationTestOperation(identifier: unknown) {
  if (
    typeof identifier !== 'string' ||
    !/^test-pagination-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      identifier,
    )
  )
    throw new Error(
      'Native pagination requires an isolated UUID fixture identifier',
    );
  if (!isSQLCipher()) throw new Error('Native pagination requires SQLCipher');
  const random = new Uint8Array(32);
  globalThis.crypto.getRandomValues(random);
  const encryptionKey = Array.from(random, byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const database = open({
    name: identifier + '.db',
    location: IOS_LIBRARY_PATH,
    encryptionKey,
  });
  try {
    const cipher = await database.execute('PRAGMA cipher_version');
    if (!cipher.rows[0]?.cipher_version)
      throw new Error('Native pagination did not open an encrypted database');
    await runMigrations(database);
    return {
      ...(await assertHealthPagination(createRecordRepository(database))),
      encrypted: true,
      syntheticRecords: true,
    };
  } finally {
    // op-sqlite drains pending work, closes this handle and deletes only its exact owned database name.
    database.delete();
  }
}
