import { SafetyPolicyEngine } from '@orot/domain';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import {
  emptyHealthReviewSafety,
  healthReviewSafetyInput,
  validHealthReviewOther,
} from '../safetyInput';
import { healthReviewSqlite } from '../testing/sqlite';
import { createHealthReviewDraftStorage } from '../draftStorage';
import { createHealthReviewService } from '../service';
import { HealthReviewController } from '../controller';
import { runLocalHealthReview } from '../../agent/healthReview/workflow';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

jest.mock('../../agent/polyfills', () => ({}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));

it('projects Other independently and retains known warnings even when its text is invalid', () => {
  const other = {
    ...emptyHealthReviewSafety(),
    symptoms: 'warning_signs' as const,
    otherSelected: true,
    otherText: '어지러움',
  };
  expect(healthReviewSafetyInput(other).symptomAssessment).toEqual({
    status: 'unknown',
  });
  expect(validHealthReviewOther(other)).toBe(true);
  expect(validHealthReviewOther({ ...other, otherText: '  ' })).toBe(false);
  expect(
    validHealthReviewOther({ ...other, otherText: 'a'.repeat(1001) }),
  ).toBe(false);
  const warning = { ...other, signs: ['chest_pain' as const], otherText: '' };
  expect(healthReviewSafetyInput(warning).symptomAssessment).toEqual({
    status: 'warning_signs',
    signs: ['chest_pain'],
  });
  expect(
    new SafetyPolicyEngine().evaluate(healthReviewSafetyInput(warning))
      .requiredActions.length,
  ).toBeGreaterThan(0);
  expect(validHealthReviewOther(warning)).toBe(false);
  expect(
    healthReviewSafetyInput({
      ...warning,
      symptoms: 'no_new_or_concerning_symptoms',
    }).symptomAssessment,
  ).toEqual({ status: 'no_new_or_concerning_symptoms' });
  expect(validHealthReviewOther({ ...warning, otherSelected: false })).toBe(
    true,
  );
});

it('restores a saved draft after closing and reopening SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orot-review-draft-'));
  const path = join(dir, 'records.sqlite');
  let db = await healthReviewSqlite(path);
  try {
    const source = await db.requests.create('검토');
    const draft = {
      ...emptyHealthReviewSafety(),
      symptoms: 'warning_signs' as const,
      signs: ['chest_pain' as const],
      otherSelected: false,
      otherText: '남겨 둔 내용',
    };
    await db.requests.saveDraft(source.id, draft);
    db.close();
    db = await healthReviewSqlite(path);
    expect((await db.requests.list())[0].draft).toEqual(draft);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects malformed stored drafts and removes source-linked drafts on deletion', async () => {
  const db = await healthReviewSqlite();
  try {
    const source = await db.requests.create('검토');
    const drafts = createHealthReviewDraftStorage(db.database);
    const storage = createLangGraphCheckpointStorage(db.database, {
      sourceRecordId: source.id,
    });
    const thread = `health-review-draft:${encodeURIComponent(source.id)}`;
    await storage.saveCheckpoint(thread, 'app-draft', {
      checkpointId: 'draft',
      parentCheckpointId: null,
      checkpointType: 'health-review-draft-v1',
      checkpoint: new TextEncoder().encode('{"signs":"bad"}'),
      metadataType: 'empty',
      metadata: new Uint8Array(),
    });
    await expect(drafts.read(source.id)).rejects.toThrow(
      'Invalid review draft',
    );
    await drafts.save(source.id, emptyHealthReviewSafety());
    await db.repository.sourceRecords.delete(source.id);
    expect(
      await storage.loadCheckpoint(thread, 'app-draft', 'draft'),
    ).toBeUndefined();
    await expect(
      drafts.save(source.id, emptyHealthReviewSafety()),
    ).rejects.toThrow();
  } finally {
    db.close();
  }
});

it('restores the request through the real service and controller after reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orot-review-service-'));
  const path = join(dir, 'records.sqlite');
  let db = await healthReviewSqlite(path);
  jest.mocked(openLocalStorage).mockResolvedValue(db.repository);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(db.database);
  const makeService = () =>
    createHealthReviewService({
      resources: async () => ({
        repository: db.repository,
        requests: db.requests,
      }),
      data: async () => db.data,
      run: runLocalHealthReview,
      resolveSelected: jest.fn(async () => {
        throw new Error(
          'Unknown symptoms must stop before provider resolution',
        );
      }),
    });
  try {
    const draft = {
      ...emptyHealthReviewSafety(),
      symptoms: 'warning_signs' as const,
      otherSelected: true,
      otherText: '어지러움',
    };
    const service = makeService();
    const started = await service.start(
      '검토',
      healthReviewSafetyInput(draft),
      { authorize: jest.fn() },
      new AbortController().signal,
      draft,
    );
    expect(started.result.status).toBe('needs_clarification');
    db.close();
    db = await healthReviewSqlite(path);
    const controller = new HealthReviewController(makeService());
    await controller.refresh();
    controller.select(started.source.id);
    expect(controller.snapshot().draft).toEqual(draft);
    expect(controller.snapshot().name).toBe('검토');
    expect(controller.snapshot().result?.status).toBe('needs_clarification');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
