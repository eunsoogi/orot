import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { audioSource } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';

test('clinician plan links require an attributed original source and follow its deletion', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const repository = createRecordRepository(db.database);
    const note = {
      ...audioSource('note'),
      sourceKind: 'clinician_note' as const,
      effectiveAt: '2026-10-01T00:00:00.000Z',
      recordedAt: '2026-10-01T00:00:00.000Z',
      provenance: {
        origin: 'clinician_recorded' as const,
        sourceRecordIds: [],
      },
    };
    await repository.put('source_record', note);
    const revision = fingerprint(note);
    const reference = {
      sourceKind: 'personal_record' as const,
      sourceId: note.id,
      sourceRevision: revision,
      evidenceId: note.id,
      evidenceRevision: revision,
      locator: {},
      effectiveTime: null,
      reviewState: 'unreviewed' as const,
    };
    const record = { kind: 'source_record' as const, id: note.id, revision };
    const treatmentContext = {
      version: 1 as const,
      conditions: [],
      clinicianPlans: {
        status: 'source_records' as const,
        sources: [{ reference, record }],
      },
      publicEvidence: [],
      missingContext: [],
      conflicts: [],
    };
    const store = createConversationArtifactStorage(db.database);
    await store.createSession('session', await store.currentGeneration());
    await store.append({
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: [{ reference, records: [record] }],
      treatmentContext,
    });
    expect((await store.read('turn'))?.treatmentContext).toEqual(
      treatmentContext,
    );
    await repository.sourceRecords.delete(note.id);
    expect(await store.read('turn')).toBeNull();
  } finally {
    db.close();
  }
});
