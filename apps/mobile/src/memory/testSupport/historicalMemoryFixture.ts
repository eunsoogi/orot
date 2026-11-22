import { AppState } from 'react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';
import {
  createAgentMemory,
  type PersistedMemoryRecord,
} from '@orot/agent-memory';
import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import {
  periodWindow,
  visitHealthFixture,
} from '../../agent/visitQuestions/testing/healthContextFixture';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { assertRetainedRecordsCurrent } from '../../storage/retainedRecordFreshness';
import { healthPeriodDependencyId } from '../../storage/healthPeriodDependencies';

/** Build an actual approved visit-question memory before simulating the old
 * backup shape, where the current-evidence period attestation didn't exist. */
export async function historicalMemoryFixture() {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'saved-historical-memory-'));
  const file = join(directory, 'memory.db');
  const original = await visitHealthFixture('measurements', file);
  const actual =
    jest.requireActual<typeof import('@orot/agent-memory')>(
      '@orot/agent-memory',
    );
  jest
    .mocked(createAgentMemory)
    .mockImplementationOnce(actual.createAgentMemory);
  const memory = await original.memory();
  const saved = await original.save({ memory });
  if (saved.memoryStatus !== 'saved')
    throw new Error('Synthetic approved write did not commit.');
  await memory.close();
  const row = (
    await original.database.execute(
      'SELECT id, record_json FROM agent_memory_records',
    )
  ).rows[0]!;
  if (typeof row.id !== 'string' || typeof row.record_json !== 'string')
    throw new Error('No durable approved memory exists.');
  const retained: PersistedMemoryRecord = JSON.parse(row.record_json);
  const raw = row.record_json;
  const question = saved.questions[0]!;
  const sourceId = healthPeriodDependencyId(question.healthContextSources![0]!);
  // Before the historical format is simulated, the ordinary evidence reader accepted it.
  const before = new SqlCipherAgentMemoryStorage(original.database);
  expect((await before.listRecords()).map(record => record.id)).toEqual([
    row.id,
  ]);
  await original.records.put('health_observation', {
    ...original.observation,
    id: 'new-synthetic-period-observation',
    effectiveAt: '2026-10-01T02:00:00Z',
  });
  const revised = await original.read(periodWindow, ['measurements']);
  const originalPeriod = question.healthContextSources![0]!;
  if (
    healthContextRevision(originalPeriod.scope, revised) ===
    originalPeriod.revision
  )
    throw new Error(
      'The synthetic current source unexpectedly matched its older revision.',
    );
  await original.database.execute('DELETE FROM memory_period_attestation');
  original.close();
  jest.mocked(createAgentMemory).mockClear();
  const owner = openSqliteTestDatabase(file);
  await runMigrations(owner.database);
  const connection = guardedNativeDatabase(owner.database);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(connection);
  return {
    id: row.id,
    retained,
    raw,
    sourceId,
    question,
    db: owner.database,
    guarded: connection,
    storage: new SqlCipherAgentMemoryStorage(connection),
    requireCurrentEvidence: () =>
      assertRetainedRecordsCurrent(
        owner.database,
        [
          {
            kind: 'reviewed_memory',
            id: row.id as string,
            revision: fingerprint({ text: retained.text, meta: retained.meta }),
          },
        ],
        createManualHistoryRepository(owner.database),
      ),
    async replace(payload: object) {
      await owner.database.execute(
        'UPDATE agent_memory_records SET record_json=? WHERE id=?',
        [JSON.stringify(payload), row.id!],
      );
    },
    close() {
      owner.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Explicit negative receipts distinguish a removed/inaccessible owner from absent evidence. */
export async function invalidateHistoricalMemoryFixture(
  file: Awaited<ReturnType<typeof historicalMemoryFixture>>,
  boundary: string,
) {
  switch (boundary) {
    case 'explicit record tombstone':
      await file.db.execute(
        'INSERT INTO agent_memory_removed_sources VALUES (?)',
        [file.id],
      );
      break;
    case 'explicit source tombstone':
      await file.db.execute(
        'INSERT INTO source_deletion_tombstones VALUES (?)',
        [file.sourceId],
      );
      break;
    case 'physical deletion':
      await file.storage.tombstone(file.id);
      break;
    case 'other namespace':
      await file.replace({
        ...file.retained,
        meta: { ...file.retained.meta, namespace: ['another-owner'] },
      });
      break;
    case 'malformed provenance':
      await file.replace({
        ...file.retained,
        meta: {
          ...file.retained.meta,
          provenance: {
            reviewState: 'human_reviewed',
            sourceIds: [file.sourceId],
            sourceDates: [
              { sourceId: 'not-in-the-source-set', date: 'synthetic' },
            ],
          },
        },
      });
      break;
    case 'forged row identity':
      await file.replace({ ...file.retained, id: 'different-row' });
      break;
    case 'forged text':
      await file.replace({
        ...file.retained,
        text: 'Unowned fabricated prose',
      });
      break;
    case 'mismatched appointment':
      await file.replace({
        ...file.retained,
        meta: {
          ...file.retained.meta,
          memoryKey: 'visit-question-review:not-this-appointment',
        },
      });
      break;
    case 'non-owner review':
      await file.db.execute(
        "UPDATE visit_questions SET payload_json=json_set(payload_json, '$.reviewState.reviewerId', 'another-owner') WHERE id=?",
        [file.question.id],
      );
      break;
    case 'orphan source identity':
      // A synthetically orphaned import must not supply a legitimate receipt.
      await file.db.execute(
        'DROP TRIGGER visit_question_period_question_deleted',
      );
      await file.db.execute('DELETE FROM visit_questions WHERE id=?', [
        file.question.id,
      ]);
      if (
        !(await file.db.execute('SELECT id FROM agent_memory_records')).rows
          .length
      )
        throw new Error('The synthetic orphan original was deleted.');
      break;
    default:
      throw new Error('Unknown synthetic history boundary.');
  }
}

/** Keep native witness values synthetic while real storage and route guards execute. */
export const nativeListeners = new Set<
  (event: ConversationExecutionEvent) => void
>();
export const checkProtection = jest.fn<Promise<boolean>, []>();
export function resetHistoricalProtectionMock() {
  jest.clearAllMocks();
  checkProtection.mockReset().mockResolvedValue(true);
  nativeListeners.clear();
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
    protectedDataAvailable: checkProtection,
    subscribe(listener) {
      nativeListeners.add(listener);
      return () => {
        nativeListeners.delete(listener);
      };
    },
  });
}
