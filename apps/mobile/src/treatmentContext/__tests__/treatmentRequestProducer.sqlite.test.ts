import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from '../interfaces';
import { produceTreatmentRequest } from '../treatmentRequestProducer';

test('explicit requests persist and follow-ups use revalidated saved context after reopening SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'treatment-producer-'));
  let db = openSqliteTestDatabase(join(directory, 'data.sqlite'));
  try {
    await runMigrations(db.database);
    let history = createManualHistoryRepository(db.database);
    const entry = await history.create({
      kind: 'diagnosis_history',
      title: 'Synthetic',
      details: 'History',
      effectiveDate: { status: 'unknown' },
    });
    const revision = fingerprint(await history.getEvidence(entry.id));
    const reference = {
      sourceKind: 'personal_record' as const,
      sourceId: entry.id,
      sourceRevision: revision,
      evidenceId: entry.id,
      evidenceRevision: revision,
      locator: {},
      effectiveTime: null,
      reviewState: 'unknown' as const,
    };
    const record = { kind: 'manual_history' as const, id: entry.id, revision };
    const authorize = jest.fn();
    const search = jest.fn();
    const request = {
      context: {
        version: 1,
        conditions: [
          {
            status: 'user_reported',
            source: reference,
            record,
            uncertainty: 'Unknown',
          },
        ],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: ['Date'],
        conflicts: [],
      },
      sources: [{ reference, records: [record] }],
      revalidateEvidence: async () => true,
      inferenceConsent: { authorize },
      publicEvidenceTool: { search },
    } as unknown as TreatmentExplanationRequest;
    let store = createConversationArtifactStorage(db.database);
    await store.createSession('session', await store.currentGeneration());
    const signal = new AbortController().signal;
    const retention = {
      id: 'first',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      question: 'Synthetic',
      expectedSessionVersion: 0,
    };
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'request', selection: { kind: 'condition', index: 0 } },
        request,
        signal,
        [],
        retention,
      ),
    ).toMatchObject({
      status: 'validated',
      claims: [
        {
          text: treatmentSafetyKo['treatmentSafety.reportedCondition'],
          citations: [reference],
        },
      ],
    });
    db.close();
    db = openSqliteTestDatabase(join(directory, 'data.sqlite'));
    history = createManualHistoryRepository(db.database);
    store = createConversationArtifactStorage(db.database);
    const forged = {
      ...request,
      context: { ...request.context, conditions: [] },
      sources: [],
    };
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'reopen', artifactId: 'first' },
        forged,
        signal,
        [],
      ),
    ).toMatchObject({
      status: 'validated',
      claims: [{ citations: [reference] }],
    });
    expect(
      await produceTreatmentRequest(
        db.database,
        {
          kind: 'follow_up',
          artifactId: 'first',
          selection: { kind: 'record_question', index: 0 },
        },
        forged,
        signal,
        [],
        { ...retention, id: 'follow', question: 'Follow-up' },
      ),
    ).toMatchObject({
      status: 'validated',
      claims: [
        {
          text: treatmentSafetyKo['treatmentSafety.recordQuestion'],
          citations: [reference],
        },
      ],
    });
    expect((await store.read('follow'))?.treatmentContext).toEqual(
      request.context,
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(
      await produceTreatmentRequest(
        db.database,
        {} as never,
        request,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    const cancelled = new AbortController();
    cancelled.abort();
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'request', selection: { kind: 'general_options' } },
        request,
        cancelled.signal,
        [],
        { ...retention, id: 'cancelled' },
      ),
    ).toEqual({ status: 'withheld', reason: 'cancelled' });
    expect(await store.read('cancelled')).toBeNull();
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'request', selection: { kind: 'general_options' } },
        request,
        signal,
        ['seek_immediate_emergency_help'],
      ),
    ).toMatchObject({ status: 'urgent' });
    const hiddenVersion = await store.hideSession('session', 0);
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'reopen', artifactId: 'first' },
        forged,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    expect(
      await produceTreatmentRequest(
        db.database,
        {
          kind: 'follow_up',
          artifactId: 'first',
          selection: { kind: 'general_options' },
        },
        forged,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    await store.undoHiddenSession('session', hiddenVersion!);
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'reopen', artifactId: 'first' },
        forged,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
    expect(
      await produceTreatmentRequest(
        db.database,
        {
          kind: 'follow_up',
          artifactId: 'first',
          selection: { kind: 'record_question', index: 0 },
        },
        forged,
        signal,
        [],
        { ...retention, id: 'stale-version' },
      ),
    ).toMatchObject({ status: 'withheld' });
    expect(await store.read('stale-version')).toBeNull();
    await history.correct(entry.id, {
      kind: 'diagnosis_history',
      title: 'Changed',
      details: 'Changed',
      effectiveDate: { status: 'unknown' },
    });
    expect(
      await produceTreatmentRequest(
        db.database,
        {
          kind: 'follow_up',
          artifactId: 'first',
          selection: { kind: 'general_options' },
        },
        forged,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    expect(
      await produceTreatmentRequest(
        db.database,
        { kind: 'reopen', artifactId: 'follow' },
        forged,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
