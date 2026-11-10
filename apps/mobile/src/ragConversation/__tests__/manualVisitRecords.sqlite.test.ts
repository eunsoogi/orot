import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createManualVisitRecords } from '../manualVisitRecordService';
import {
  mkdtempSync,
  rmSync,
  tmpdir,
  join,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

test('reads prepared questions without confirming them and reopens saved edits in SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-visit-records-'));
  const path = join(directory, 'records.sqlite');
  let db = openSqliteTestDatabase(path);
  try {
    await runMigrations(db.database);
    const records = createRecordRepository(db.database);
    const time = '2026-11-06T00:00:00Z';
    const metadata = {
      effectiveAt: time,
      recordedAt: time,
      ingestedAt: time,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await records.put('appointment', {
      id: 'visit-1',
      status: 'scheduled',
      ...metadata,
    });
    await records.put('visit_question', {
      id: 'q-1',
      appointmentId: 'visit-1',
      questionText: '질문',
      priority: 'routine',
      evidenceSpanIds: [],
      ...metadata,
    });
    const service = createManualVisitRecords(db.database);
    const [prepared] = await service.load('visit-1');
    expect(prepared.records).toEqual([]);
    const saved = await service.saveManual({
      appointmentId: 'visit-1',
      questionId: 'q-1',
      expectedQuestionRevision: prepared.revision,
      answer: null,
    });
    expect(
      await service.saveManual({
        appointmentId: 'visit-1',
        questionId: 'q-1',
        expectedQuestionRevision: prepared.revision,
        answer: null,
      }),
    ).toEqual(saved);
    const edited = await service.edit({
      id: saved.id,
      expectedRevision: saved.revision,
      answer: '답변',
    });
    await expect(
      service.edit({
        id: saved.id,
        expectedRevision: saved.revision,
        answer: '오래된 답변',
      }),
    ).rejects.toThrow();
    db.close();
    db = openSqliteTestDatabase(path);
    const reopened = createManualVisitRecords(db.database);
    expect((await reopened.load('visit-1'))[0].records).toEqual([edited]);
    await createRecordRepository(db.database).delete('visit_question', 'q-1');
    expect(await reopened.load('visit-1')).toEqual([]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
