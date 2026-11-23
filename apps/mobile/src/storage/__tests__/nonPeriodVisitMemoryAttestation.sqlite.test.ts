import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { saveReviewedVisitQuestions } from '../../agent/visitQuestions/persistence';
import {
  appointment,
  candidate,
  now,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import {
  localEvidenceFingerprint,
  visitQuestionCitationKey,
} from '../../agent/visitQuestions/evidence';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';
import { decodeAgentMemoryRecord } from '../agentMemoryStorageRecords';
import { readHistoricalSavedMemory } from '../readHistoricalSavedMemory';
import { guardedNativeDatabase } from '../protectedReadEpoch';
import { verifyReviewedMemoryRevisions } from '../testSupport/nonPeriodVisitAttestationBoundary';
import { openLocalAgentMemoryDatabase } from '../secureDatabase';

jest.mock('../../ragConversation/conversationExecutionNative');
jest.mock('../secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test.each(['source deletion', 'revision changes'] as const)(
  'only an exact committed re-review survives benign quarantine (%s)',
  async boundary => {
    const { mkdtempSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'visit-re-review-'));
    const path = join(dir, 'fixture.db');
    const f = await healthContextFixture(undefined, path);
    let didClose = false;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
    try {
      await f.storage.append(f.saved);
      await f.repository.put('appointment', appointment);
      const revision = fingerprint(await f.storage.read(f.saved.id));
      const citation = {
        sourceKind: 'generated_artifact' as const,
        sourceId: f.saved.id,
        sourceRevision: revision,
        evidenceId: f.saved.id,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'symptom_summary' },
        effectiveTime: null,
        reviewState: 'unreviewed' as const,
        content: 'Synthetic report body.',
      };
      const source = {
        kind: 'generated_summary' as const,
        type: 'symptom_summary' as const,
        id: f.saved.id,
        revision,
      };
      const memory = await createAgentMemory({
        embedder: {
          embed: async (texts: string[]) =>
            texts.map(() => Float32Array.from([1, 0, 0])),
        },
        storage: new SqlCipherAgentMemoryStorage(f.database),
      });
      const save = async (step: number) => {
        const previous = await f.repository.get(
          'visit_question',
          candidate.identity!.id,
        );
        const current = Date.parse(now) + step * 60_000;
        clock.mockReturnValue(current);
        return saveReviewedVisitQuestions({
          appointmentId: appointment.id,
          expectedAppointmentRevision: localEvidenceFingerprint(
            await f.repository.get('appointment', appointment.id),
          ),
          expectedSavedQuestions: previous
            ? [
                {
                  id: previous.id,
                  revision: localEvidenceFingerprint(previous),
                },
              ]
            : [],
          questions: [
            {
              ...candidate,
              identity: previous
                ? {
                    id: previous.id,
                    expectedRevision: localEvidenceFingerprint(previous),
                  }
                : candidate.identity,
              ...(step === 0 ? { kind: 'clarification' as const } : {}),
              questionText:
                step === 0
                  ? '처음 검토한 합성 질문인가요?'
                  : `다시 검토한 ${['처음', '기록', '검사', '증상'][step]} 질문인가요?`,
              citations: step === 0 ? [] : [citation],
            },
          ],
          evidence: {
            batch: { items: [citation], coverage: [], conflicts: [] },
            metadataByCitation: new Map([
              [
                visitQuestionCitationKey(citation),
                {
                  sourceRecordIds: [],
                  sourceRecordRevisions: [],
                  sourceDates: [],
                  generatedArtifactSource: source,
                },
              ],
            ]),
            memoryStatus: 'no_matching_current_memory',
          },
          repository: f.repository,
          memory,
          now: new Date(current).toISOString(),
          revalidateEvidence: async () => true,
        });
      };
      expect((await save(0)).memoryStatus).toBe('saved');
      const old = (
        await listSavedMemories(new SqlCipherAgentMemoryStorage(f.database))
      )[0]!;
      const replacement = await save(1);
      expect(replacement.memoryStatus).toBe('saved');
      expect(replacement.questions[0]?.healthContextSources).toBeUndefined();
      const { rows } = await f.database.execute(
        'SELECT id,record_json FROM agent_memory_records',
      );
      expect(rows).toHaveLength(1);
      const saved = decodeAgentMemoryRecord(rows[0]!.record_json);
      expect(saved.id).not.toBe(old.id);
      expect(saved.createdAt).toBe(old.createdAt);
      const witnessTable = 'memory_non_period_visit_attestation';
      const receipts = (
        await f.database.execute(`SELECT * FROM ${witnessTable}`)
      ).rows;
      expect(receipts).toEqual([
        expect.objectContaining({
          memory_id: saved.id,
          parents_json: JSON.stringify([
            {
              id: replacement.questions[0]!.id,
              revision: fingerprint(replacement.questions[0]),
            },
          ]),
        }),
      ]);
      // Fail after the memory update has staged, not before it.
      await f.database.execute(
        `CREATE TRIGGER synthetic_reject_review_receipt BEFORE INSERT ON ${witnessTable}
       BEGIN SELECT RAISE(ABORT,'synthetic receipt rejection'); END`,
      );
      expect((await save(2)).memoryStatus).toBe('retry_required');
      expect(
        (
          await f.database.execute(
            'SELECT id,record_json FROM agent_memory_records',
          )
        ).rows,
      ).toEqual(rows);
      expect(
        (await f.database.execute(`SELECT * FROM ${witnessTable}`)).rows,
      ).toEqual(receipts);
      await f.database.execute('DROP TRIGGER synthetic_reject_review_receipt');
      const committed = await save(3);
      expect(committed.memoryStatus).toBe('saved');
      const next = (
        await listSavedMemories(new SqlCipherAgentMemoryStorage(f.database))
      )[0]!;
      expect(next.id).not.toBe(saved.id);
      await memory.close();
      await f.database.execute(
        "UPDATE summary_period_policy SET status='quarantined' WHERE summary_id=?",
        [f.saved.id],
      );
      f.close();
      didClose = true;
      const reopened = openSqliteTestDatabase(path);
      try {
        await runMigrations(reopened.database);
        const owner = guardedNativeDatabase(reopened.database);
        jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(owner);
        jest.mocked(conversationExecutionNative).mockReturnValue({
          bridgeAvailable: true,
          begin: jest.fn(),
          end: jest.fn(),
          isActive: jest.fn(),
          currentPhase: () => 'active',
          protectedDataAvailable: async () => true,
          subscribe: () => () => undefined,
        });
        expect(
          await listSavedMemories(new SqlCipherAgentMemoryStorage(owner)),
        ).toEqual([]);
        expect(await readHistoricalSavedMemory(next.id)).toEqual({
          id: next.id,
          createdAt: next.createdAt,
          text: next.text,
        });
        expect(await readHistoricalSavedMemory(old.id)).toBeNull();
        const proof = (
          await reopened.database.execute(
            `SELECT parents_json FROM ${witnessTable} WHERE memory_id=?`,
            [next.id],
          )
        ).rows[0]!.parents_json!;
        const setProof = (value: string) =>
          reopened.database.execute(
            `UPDATE ${witnessTable} SET parents_json=? WHERE memory_id=?`,
            [value, next.id],
          );
        await setProof('[]');
        expect(await readHistoricalSavedMemory(next.id)).toBeNull();
        await setProof(String(proof));
        expect(await readHistoricalSavedMemory(next.id)).not.toBeNull();
        if (boundary === 'revision changes') {
          await verifyReviewedMemoryRevisions(
            reopened.database,
            next.id,
            committed.questions[0]!.id,
          );
          return;
        }
        await reopened.database.execute(
          'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
          [`generated-artifact:generated_summary:${f.saved.id}`],
        );
        expect(await readHistoricalSavedMemory(next.id)).toBeNull();
      } finally {
        reopened.close();
      }
    } finally {
      clock.mockRestore();
      if (!didClose) f.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
