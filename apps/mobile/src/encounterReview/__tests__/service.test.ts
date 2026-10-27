const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };
const { randomFillSync } = require('node:crypto') as {
  randomFillSync(value: Uint8Array): Uint8Array;
};
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
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { persistEncounterApproval } from '../../agent/encounter/persistence';
import { createEncounterReviewSessions } from '../../agent/encounter/reviewSession';
import { createLangGraphCheckpointStorage } from '@orot/storage';

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
let directory: string;
let handle: ReturnType<typeof openSqliteTestDatabase>;
const sourceId = 'synthetic-review-recording';
const repository = () => createRecordRepository(handle.database);
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
const rows = async () => repository().list('health_observation');
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'orot-review-'));
  handle = openSqliteTestDatabase(join(directory, 'records.sqlite'));
  await runMigrations(handle.database);
  jest.mocked(openLocalStorage).mockImplementation(async () => repository());
  jest
    .mocked(openLocalAgentMemoryDatabase)
    .mockImplementation(async () => handle.database);
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: randomFillSync },
  });
  await seedSyntheticEncounter(repository(), sourceId);
});
afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});
const consent = { authorize: jest.fn(async () => 'authorized' as const) };

test('source discovery survives closed database and fresh controller without re-extraction or approval', async () => {
  const first = controllerFor();
  await first.controller.restore();
  expect(first.controller.state.status).toBe('idle');
  expect(first.synthetic.calls()).toBe(0);
  await first.controller.start(consent);
  const original = first.controller.state.pending;
  expect(original?.sourceId).toBe(sourceId);
  expect(first.synthetic.calls()).toBe(1);
  expect(await rows()).toHaveLength(0);
  first.controller.dispose();
  handle.close();
  handle = openSqliteTestDatabase(join(directory, 'records.sqlite'));
  const second = controllerFor(false, false);
  await second.controller.restore();
  expect(second.controller.state.pending).toEqual(original);
  expect(second.synthetic.calls()).toBe(0);
  expect(await rows()).toHaveLength(0);
  second.controller.edit('candidate-0', 'text', '사용자가 검토한 내용');
  second.controller.edit('candidate-0', 'dosageInstruction', '');
  await second.controller.decide('approve');
  expect(second.controller.state.status).toBe('saved');
  expect(await rows()).toHaveLength(2);
  expect(
    (await rows()).find(
      record => record.concept === 'encounter_medication_statement',
    )?.value,
  ).toEqual({ kind: 'text', text: '사용자가 검토한 내용' });
  expect(
    (await rows()).every(
      record =>
        record.reviewState.status === 'reviewed' &&
        record.provenance.origin === 'derived',
    ),
  ).toBe(true);
  const third = controllerFor(false, false);
  await third.controller.restore();
  expect(third.controller.state.status).toBe('saved');
});

test('denied transmission never calls the provider; exact single-source scope is disclosed', async () => {
  const { controller, synthetic } = controllerFor(true);
  const denied = {
    authorize: jest.fn(async () => 'renewal_required' as const),
  };
  await controller.start(denied);
  expect(controller.state.status).toBe('consent-denied');
  expect(synthetic.calls()).toBe(0);
  expect(await rows()).toHaveLength(0);
  expect(denied.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: [sourceId] },
      modelId: 'synthetic',
      recipient: 'selected-account',
    }),
  );
});

test('rejection writes nothing and a deliberate new attempt gets a different discoverable identity', async () => {
  const { controller } = controllerFor();
  await controller.start(consent);
  const first = controller.state.pending!.threadId;
  await controller.decide('deny');
  expect(controller.state.status).toBe('denied');
  expect(await rows()).toHaveLength(0);
  await controller.start(consent);
  expect(controller.state.pending!.threadId).not.toBe(first);
});

test('correction and logical deletion fence stale approval and remove discovery without late resurrection', async () => {
  const { controller, service } = controllerFor();
  await controller.start(consent);
  const pending = controller.state.pending!;
  const segment = (
    await repository().transcripts.listForRecording(sourceId)
  )[0];
  await repository().transcripts.correct(
    segment.id,
    '수정한 전사',
    '2035-01-03T00:00:00Z',
  );
  await controller.decide('approve');
  expect(controller.state.status).toBe('unavailable');
  expect(await rows()).toHaveLength(0);
  await new SqlCipherAgentMemoryStorage(handle.database).markSourceRemoved(
    sourceId,
  );
  expect(await service.restore(sourceId, new AbortController().signal)).toEqual(
    { status: 'unavailable' },
  );
  expect(
    await service.decide(
      sourceId,
      {
        pending,
        decision: 'approve',
        candidates: pending.candidates,
        reviewerId: 'local-user',
        reviewedAt: new Date().toISOString(),
      },
      new AbortController().signal,
    ),
  ).toEqual({ status: 'unavailable' });
  expect(await rows()).toHaveLength(0);
});

test('another database connection replaces a preview attempt before approval enters its write transaction', async () => {
  const first = controllerFor();
  await first.controller.start(consent);
  const pending = first.controller.state.pending!;
  // A already read the descriptor. B replaces it through a separate connection before A commits.
  const other = openSqliteTestDatabase(join(directory, 'records.sqlite'));
  try {
    await createEncounterReviewSessions(
      createLangGraphCheckpointStorage(other.database, {
        sourceRecordId: sourceId,
      }),
      sourceId,
    ).begin();
    await expect(
      persistEncounterApproval(
        repository(),
        pending,
        {
          pending,
          decision: 'approve',
          candidates: pending.candidates,
          reviewerId: 'local-user',
          reviewedAt: new Date().toISOString(),
        },
        new AbortController().signal,
        true,
      ),
    ).rejects.toThrow('replaced');
    expect(await rows()).toHaveLength(0);
    expect(
      await repository().evidenceSpans.listForSourceRecord(sourceId),
    ).toHaveLength(0);
  } finally {
    other.close();
  }
});
