import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from '../interfaces';
import { explainTreatmentEducation } from '../treatmentEducation';
import { createTreatmentSafetyService } from '../treatmentSafetyService';

test('preserves source status and withholds when its source is deleted', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const history = createManualHistoryRepository(db.database);
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
    const request = {
      context: {
        version: 1,
        conditions: [
          {
            status: 'user_reported',
            source: reference,
            record,
            uncertainty: 'Unknown date',
          },
        ],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: ['Date'],
        conflicts: [],
      },
      sources: [{ reference, records: [record] }],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    const run = (selection: Parameters<typeof explainTreatmentEducation>[2]) =>
      explainTreatmentEducation(
        db.database,
        request,
        selection,
        new AbortController().signal,
        [],
      );
    expect(await run({ kind: 'general_options' })).toMatchObject({
      status: 'validated',
      claims: [
        {
          text: treatmentSafetyKo['treatmentSafety.generalOptions'],
          citations: [],
        },
      ],
    });
    expect(await run({ kind: 'benefits_risks' })).toMatchObject({
      status: 'validated',
    });
    expect(await run({ kind: 'discuss_options' })).toMatchObject({
      status: 'validated',
    });
    expect(await run({ kind: 'condition', index: 0 })).toMatchObject({
      status: 'validated',
      claims: [
        {
          text: treatmentSafetyKo['treatmentSafety.reportedCondition'],
          citations: [reference],
        },
      ],
    });
    expect(await run({ kind: 'record_question', index: 0 })).toMatchObject({
      status: 'validated',
    });
    const possibility = {
      ...request,
      context: {
        ...request.context,
        conditions: [
          {
            status: 'ai_possibility' as const,
            title: 'Synthetic',
            supportingEvidence: [reference],
            contraryEvidence: [],
            uncertainty: 'Uncertain',
            missingData: ['Date'],
          },
        ],
      },
    };
    const signal = new AbortController().signal;
    const cancelled = new AbortController();
    cancelled.abort();
    expect(
      await explainTreatmentEducation(
        db.database,
        request,
        { kind: 'general_options' },
        cancelled.signal,
        [],
      ),
    ).toEqual({ status: 'withheld', reason: 'cancelled' });
    expect(
      await explainTreatmentEducation(
        db.database,
        request,
        { kind: 'general_options' },
        signal,
        ['seek_immediate_emergency_help'],
      ),
    ).toMatchObject({ status: 'urgent' });
    expect(
      await explainTreatmentEducation(
        db.database,
        possibility,
        { kind: 'condition', index: 0 },
        signal,
        [],
      ),
    ).toMatchObject({
      status: 'validated',
      claims: [
        {
          text: treatmentSafetyKo['treatmentSafety.possibleCondition'],
          citations: [reference],
        },
      ],
    });
    expect(
      await explainTreatmentEducation(
        db.database,
        possibility,
        { kind: 'record_question', index: 0 },
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    const safety = createTreatmentSafetyService(db.database);
    const artifact = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'local',
      modelId: 'app-owned',
      status: 'complete' as const,
      question: 'Synthetic question',
      answer: treatmentSafetyKo['treatmentSafety.possibleCondition'],
      sources: possibility.sources,
      citations: [reference],
      treatmentContext: possibility.context,
    };
    expect(await safety.save(artifact, possibility, signal, [])).toMatchObject({
      status: 'validated',
    });
    expect(await safety.reopen('turn', possibility, signal, [])).toMatchObject({
      status: 'validated',
    });
    expect(await run({ kind: 'condition', index: 2 })).toMatchObject({
      status: 'withheld',
    });
    const forged = {
      ...request,
      context: {
        ...request.context,
        conditions: [
          {
            ...request.context.conditions[0],
            status: 'clinician_recorded' as const,
          },
        ],
      },
    } as TreatmentExplanationRequest;
    expect(
      await explainTreatmentEducation(
        db.database,
        forged,
        { kind: 'condition', index: 0 },
        new AbortController().signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    await history.delete(entry.id);
    expect(await run({ kind: 'condition', index: 0 })).toMatchObject({
      status: 'withheld',
    });
    expect(await safety.reopen('turn', possibility, signal, [])).toMatchObject({
      status: 'withheld',
    });
  } finally {
    db.close();
  }
});
