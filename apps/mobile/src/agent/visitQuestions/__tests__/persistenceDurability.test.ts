import { createRecordRepository, runMigrations } from '@orot/storage';
import { EvidenceSpanSchema, SourceRecordSchema } from '@orot/domain';
import { saveReviewedVisitQuestions } from '../persistence';
import { clarificationQuestions } from '../clarificationQuestions';
import { localEvidenceFingerprint } from '../evidence';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  appointment,
  candidate,
  evidenceSpan,
  input,
  oldQuestion,
  repository,
  sourceRecord,
} from '../testing/persistenceFixtures';

declare const require: (specifier: string) => unknown;

interface TestFileSystem {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

interface TestOs {
  tmpdir(): string;
}

interface TestPath {
  join(...parts: string[]): string;
}

const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
const { tmpdir } = require('node:os') as TestOs;
const { join } = require('node:path') as TestPath;

describe('reviewed visit-question durability', () => {
  it('preserves a legacy row while rejecting a transcript invalidation that arrives before save', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-visit-legacy-'));
    const path = join(directory, 'records.sqlite');
    const opened = openSqliteTestDatabase(path);
    try {
      await runMigrations(opened.database);
      const records = createRecordRepository(opened.database);
      await records.put('appointment', appointment);
      const original = oldQuestion('legacy-question', appointment.id);
      await records.put('visit_question', original as never);
      const question = {
        identity: {
          id: original.id,
          expectedRevision: localEvidenceFingerprint(original),
        },
        questionText: '이전 질문을 다시 확인할까요?',
        rationale: '이전 내용을 확인할 수 있어요.',
        priority: 'routine' as const,
        citations: [],
        legacySource: {
          id: original.id,
          revision: localEvidenceFingerprint(original),
        },
      };
      const saved = await saveReviewedVisitQuestions({
        ...input(repository(), { questions: [question] }),
        expectedSavedQuestions: [
          { id: original.id, revision: localEvidenceFingerprint(original) },
        ],
        repository: records,
      });
      expect(saved.questions[0]).toMatchObject({
        questionText: question.questionText,
        provenance: original.provenance,
        evidenceSpanIds: [],
      });
      const current = saved.questions[0]!;
      await opened.database.execute(
        'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          'transcript',
          'visit_question',
          current.id,
          'old',
          'new',
          '2026-10-07T04:00:00.000Z',
        ],
      );
      const second = {
        ...question,
        identity: {
          id: current.id,
          expectedRevision: localEvidenceFingerprint(current),
        },
        legacySource: {
          id: current.id,
          revision: localEvidenceFingerprint(current),
        },
      };
      await expect(
        saveReviewedVisitQuestions({
          ...input(repository(), { questions: [second] }),
          expectedSavedQuestions: [
            { id: current.id, revision: localEvidenceFingerprint(current) },
          ],
          repository: records,
        }),
      ).rejects.toThrow(/stale transcript evidence/i);
      await expect(records.get('visit_question', current.id)).resolves.toEqual(
        current,
      );
    } finally {
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('keeps the reviewed list after the local record database is reopened', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-visit-question-save-'));
    const path = join(directory, 'records.sqlite');
    let opened: ReturnType<typeof openSqliteTestDatabase> | null = null;
    try {
      opened = openSqliteTestDatabase(path);
      await runMigrations(opened.database);
      const records = createRecordRepository(opened.database);
      await records.put('appointment', appointment);
      await records.put(
        'source_record',
        SourceRecordSchema.parse(sourceRecord),
      );
      await records.put(
        'evidence_span',
        EvidenceSpanSchema.parse(evidenceSpan),
      );

      await saveReviewedVisitQuestions({
        ...input(repository()),
        repository: records,
        questions: [
          candidate,
          {
            ...clarificationQuestions[0]!,
            identity: { id: 'synthetic-question-2' },
            kind: 'clarification',
            priority: 'routine',
            citations: [],
          },
        ],
      });
      opened.close();
      opened = null;

      // Reopening proves storage survives a connection boundary; SQLCipher runtime proof remains separate.
      opened = openSqliteTestDatabase(path);
      await runMigrations(opened.database);
      const reopenedRecords = createRecordRepository(opened.database);
      await expect(
        reopenedRecords.get('visit_question', 'synthetic-question-1'),
      ).resolves.toMatchObject({
        questionText: candidate.questionText,
        appointmentId: 'appointment-1',
        evidenceSpanIds: ['span-1'],
        provenance: { sourceRecordIds: ['appointment-1', 'source-1'] },
        reviewState: { status: 'reviewed', reviewerId: 'local-user' },
      });
      await expect(
        reopenedRecords.get('visit_question', 'synthetic-question-2'),
      ).resolves.toMatchObject({
        kind: 'clarification',
        questionText: clarificationQuestions[0]!.questionText,
        evidenceSpanIds: [],
        provenance: { sourceRecordIds: ['appointment-1'] },
      });
    } finally {
      opened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
