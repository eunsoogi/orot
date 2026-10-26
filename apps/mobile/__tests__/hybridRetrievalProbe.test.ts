// This SQLite harness checks persistence semantics; XCTest remains the native SQLCipher/E5 proof.
jest.mock('@op-engineering/op-sqlite', () => ({
  isSQLCipher: () => true,
}));

jest.mock('../src/storage/secureDatabase', () => ({
  getCipherVersion: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../src/rag/localE5NativeBackend', () => ({
  localE5NativeBackend: {
    prepare: jest.fn(
      async (
        _requestId: string,
        onProgress: (completed: number, total: number) => void,
      ) => onProgress(1, 1),
    ),
    embedBatch: jest.fn(async (input: readonly string[]) =>
      input.map(() => [1, ...Array(383).fill(0)]),
    ),
    cancel: jest.fn(),
  },
}));

import { openEncryptedStorage, runMigrations } from '@orot/storage';
import {
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from '../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import * as secureDatabase from '../src/storage/secureDatabase';
import { installFingerprint } from '../src/storage/testSupport/vectorStore';
import { runHybridRetrievalProbe } from '../e2e/hybridRetrievalProbe';

test('indexes prepared hybrid sources and reuses the retained vector after reopening storage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-hybrid-retrieval-'));
  const databasePath = join(directory, 'hybrid.sqlite');
  let opened = openSqliteTestDatabase(databasePath);
  let database = opened.database;
  let closeDatabase = opened.close;

  try {
    installFingerprint();
    await runMigrations(database);
    await database.execute('PRAGMA temp_store = 2');
    let repository = await openEncryptedStorage(options(database));
    jest.mocked(secureDatabase.getCipherVersion).mockResolvedValue('test-only');
    jest
      .mocked(secureDatabase.openLocalAgentMemoryDatabase)
      .mockResolvedValue(database);
    jest.mocked(secureDatabase.openLocalStorage).mockResolvedValue(repository);

    const fresh = await runHybridRetrievalProbe();
    expect(fresh).toMatchObject({
      mode: 'indexed',
      remainingVectorCount: 1,
      remainingVectorIds: ['hybrid-synthetic-sleep'],
      filtersApplied: true,
      locatorPreserved: true,
      temporaryTablesCleaned: true,
    });

    closeDatabase();
    opened = openSqliteTestDatabase(databasePath);
    database = opened.database;
    closeDatabase = opened.close;
    await runMigrations(database);
    await database.execute('PRAGMA temp_store = 2');
    repository = await openEncryptedStorage(options(database));
    jest
      .mocked(secureDatabase.openLocalAgentMemoryDatabase)
      .mockResolvedValue(database);
    jest.mocked(secureDatabase.openLocalStorage).mockResolvedValue(repository);

    // A new connection must find the persisted source rows and only the retained sleep vector.
    const reopened = await runHybridRetrievalProbe();
    expect(reopened).toMatchObject({
      mode: 'reopened',
      remainingVectorCount: 1,
      remainingVectorIds: ['hybrid-synthetic-sleep'],
      filtersApplied: true,
      locatorPreserved: true,
      temporaryTablesCleaned: true,
    });
  } finally {
    closeDatabase();
    rmSync(directory, { recursive: true, force: true });
  }
});
