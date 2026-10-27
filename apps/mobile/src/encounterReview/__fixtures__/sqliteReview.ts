const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  openLocalStorage,
  openLocalAgentMemoryDatabase,
} from '../../storage/secureDatabase';
import {
  seedSyntheticEncounter,
  syntheticEncounterModel,
} from '../../agent/encounter/syntheticFixture';
import { createEncounterReviewService } from '../service';
import { EncounterReviewController } from '../controller';

jest.mock('../../agent/polyfills', () => ({}));
jest.mock('../../agent/execution/consentFingerprint', () => ({
  fingerprintConsentSnapshot: async (text: string) =>
    require('node:crypto').createHash('sha256').update(text).digest('hex'),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));

export const sourceId = 'synthetic-review-recording';
export const consent = {
  authorize: jest.fn(async () => 'authorized' as const),
};

/** Only native module access is replaced; production service, graph and SQLite transactions execute unchanged. */
export function sqliteReviewFixture() {
  let directory: string;
  let handle: ReturnType<typeof openSqliteTestDatabase>;
  const database = () => handle.database;
  const repository = () => createRecordRepository(handle.database);
  const openSecondConnection = () =>
    openSqliteTestDatabase(join(directory, 'records.sqlite'));
  const reopen = () => {
    handle.close();
    handle = openSecondConnection();
  };
  const controllerFor = (remote = false, allowModel = true) => {
    const synthetic = syntheticEncounterModel(sourceId, allowModel);
    const service = createEncounterReviewService(async () => ({
      status: 'ready',
      selection: {
        providerId: synthetic.model.provider.id,
        modelId: 'synthetic',
      },
      option: {
        provider: synthetic.model.provider,
        modelId: 'synthetic',
        displayName: 'Synthetic',
        privacyBoundary: remote ? 'selected-context-remote' : 'on-device',
        availability: { status: 'available' },
      },
      provider: synthetic.model.provider,
      modelId: 'synthetic',
      recipient: remote ? 'selected-account' : 'on-device',
      remoteProcessing: remote,
    }));
    return {
      service,
      synthetic,
      controller: new EncounterReviewController(sourceId, service, jest.fn()),
    };
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'orot-review-'));
    handle = openSecondConnection();
    await runMigrations(handle.database);
    jest.mocked(openLocalStorage).mockImplementation(async () => repository());
    jest
      .mocked(openLocalAgentMemoryDatabase)
      .mockImplementation(async () => handle.database);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) =>
          require('node:crypto').randomFillSync(bytes),
      },
    });
    await seedSyntheticEncounter(repository(), sourceId);
  });
  afterEach(() => {
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    controllerFor,
    repository,
    database,
    openSecondConnection,
    reopen,
    rows: () => repository().list('health_observation'),
  };
}
