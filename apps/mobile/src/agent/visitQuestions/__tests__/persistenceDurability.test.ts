import { createRecordRepository, runMigrations } from '@orot/storage';
import { EvidenceSpanSchema, SourceRecordSchema } from '@orot/domain';
import { saveReviewedVisitQuestions } from '../persistence';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  appointment,
  candidate,
  evidenceSpan,
  input,
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
      });
      opened.close();
      opened = null;

      // Reopening proves storage survives a connection boundary; SQLCipher runtime proof remains separate.
      opened = openSqliteTestDatabase(path);
      await runMigrations(opened.database);
      const reopenedRecords = createRecordRepository(opened.database);
      await expect(
        reopenedRecords.get('visit_question', 'visit-question:appointment-1:1'),
      ).resolves.toMatchObject({
        questionText: candidate.questionText,
        appointmentId: 'appointment-1',
        evidenceSpanIds: ['span-1'],
        provenance: { sourceRecordIds: ['appointment-1', 'source-1'] },
        reviewState: { status: 'reviewed', reviewerId: 'local-user' },
      });
    } finally {
      opened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
