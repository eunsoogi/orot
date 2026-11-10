import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { createSymptomSummaryStorage } from '../../storage/symptomSummaryStorage';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { listTreatmentSourceChoices } from '../treatmentSourceChoices';
import {
  prepareTreatmentRetention,
  deleteSavedTreatment,
} from '../treatmentSavedLibrary';
import { produceTreatmentRequest } from '../treatmentRequestProducer';
import { savedEducation } from '../localTreatmentEvidence';

test('production choices bind clinician attribution and exact possibility references with the parent revision', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    const { database } = db;
    await runMigrations(database);
    const signal = new AbortController().signal;
    const observation = {
      ...healthObservation(
        'diagnosis-id',
        '합성 의료진 진단',
        '2026-10-01T01:00:00Z',
      ),
      observationKind: 'diagnosis' as const,
      provenance: {
        origin: 'clinician_recorded' as const,
        sourceRecordIds: [],
      },
    };
    await createRecordRepository(database).put(
      'health_observation',
      observation,
    );
    const history = createManualHistoryRepository(database);
    const entry = await history.create({
      kind: 'diagnosis_history',
      title: '합성 기록',
      details: '합성 원문',
      effectiveDate: { status: 'unknown' },
    });
    const revision = fingerprint(await history.getEvidence(entry.id));
    const reference = {
      sourceKind: 'personal_record' as const,
      sourceId: entry.id,
      sourceRevision: revision,
      evidenceId: entry.id,
      evidenceRevision: revision,
      effectiveTime: null,
      locator: { kind: 'manual_history', entryId: entry.id },
      reviewState: 'unreviewed' as const,
    };
    const summary = {
      id: 'possibility-parent',
      createdAt: '2026-10-01T01:00:00.000Z',
      modelName: 'Synthetic',
      modelId: 'synthetic',
      providerId: 'synthetic',
      inputLineage: 'complete' as const,
      sources: [
        {
          reference,
          records: [
            { kind: 'manual_history' as const, id: entry.id, revision },
          ],
        },
      ],
      analysis: {
        hypotheses: [
          {
            title: '합성 가능성',
            summary: '추가 확인이 필요해요.',
            uncertainty: '자료가 충분하지 않아요.',
            missingData: ['진료 결과'],
            supportingEvidence: [reference],
            contraryEvidence: [],
          },
        ],
      },
    };
    await createSymptomSummaryStorage(database).append(summary);
    const choices = await listTreatmentSourceChoices(database, signal);
    expect(choices.map(choice => choice.status)).toEqual([
      'user_reported',
      'clinician_recorded',
      'ai_possibility',
    ]);
    const action = {
      kind: 'request',
      selection: { kind: 'condition', index: 0 },
    } as const;
    const clinician = choices[1]!;
    expect(
      await produceTreatmentRequest(
        database,
        action,
        clinician.request,
        signal,
        [],
      ),
    ).toMatchObject({
      status: 'validated',
      claims: [
        {
          text: treatmentSafetyKo['treatmentSafety.clinicianCondition'],
          citations: [
            expect.objectContaining({
              sourceRevision: fingerprint(observation),
            }),
          ],
        },
      ],
    });
    const possibility = choices[2]!;
    expect(possibility.request.sources).toContainEqual(
      expect.objectContaining({
        kind: 'generated_summary',
        id: summary.id,
        revision: fingerprint(summary),
      }),
    );
    const store = createConversationArtifactStorage(database);
    const lease = { id: 'source-test-session', version: 0 };
    await store.createSession(lease.id, await store.currentGeneration());
    const retention = prepareTreatmentRetention(lease);
    expect(
      await produceTreatmentRequest(
        database,
        action,
        possibility.request,
        signal,
        [],
        retention,
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
    const reopen = {
      kind: 'reopen',
      artifactId: retention.id,
      sessionId: retention.sessionId,
    } as const;
    expect(
      await produceTreatmentRequest(
        database,
        reopen,
        possibility.request,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
    const followUpRetention = prepareTreatmentRetention(lease, retention);
    expect(
      await produceTreatmentRequest(
        database,
        {
          kind: 'follow_up',
          artifactId: retention.id,
          sessionId: retention.sessionId,
          selection: { kind: 'source_question', index: 0 },
        },
        savedEducation,
        signal,
        [],
        followUpRetention,
      ),
    ).toMatchObject({
      status: 'validated',
      claims: [
        {
          text: treatmentSafetyKo['treatmentSafety.discussOptions'],
          citations: [],
        },
      ],
    });
    await deleteSavedTreatment(database, retention, lease);
    expect(
      await produceTreatmentRequest(
        database,
        {
          kind: 'reopen',
          artifactId: followUpRetention.id,
          sessionId: followUpRetention.sessionId,
        },
        savedEducation,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    expect(
      await produceTreatmentRequest(
        database,
        reopen,
        possibility.request,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    await database.execute('DELETE FROM symptom_summary_runs WHERE id = ?', [
      summary.id,
    ]);
    expect(
      await produceTreatmentRequest(
        database,
        action,
        possibility.request,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
  } finally {
    db.close();
  }
});
