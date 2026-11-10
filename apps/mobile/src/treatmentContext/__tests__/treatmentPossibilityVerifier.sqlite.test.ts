import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import type { TreatmentExplanationRequest } from '../interfaces';
import { createTreatmentClaimVerifier } from '../treatmentClaimVerifier';
import { evaluateTreatmentOutput } from '../treatmentSafetyBoundary';

test('possibility stays uncertain and requires its supporting and contrary source revisions', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const history = createManualHistoryRepository(db.database);
    const makeSource = async (title: string) => {
      const entry = await history.create({
        kind: 'diagnosis_history',
        title,
        details: 'Synthetic',
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
      return {
        reference,
        records: [{ kind: 'manual_history' as const, id: entry.id, revision }],
      };
    };
    const supporting = await makeSource('Supporting');
    const contrary = await makeSource('Contrary');
    const context = {
      version: 1,
      clinicianPlans: { status: 'unavailable' },
      conditions: [
        {
          status: 'ai_possibility',
          title: 'Synthetic possibility',
          supportingEvidence: [supporting.reference],
          contraryEvidence: [contrary.reference],
          uncertainty: 'Uncertain',
          missingData: ['Timing'],
        },
      ],
      publicEvidence: [],
      missingContext: ['Timing'],
      conflicts: ['Sources differ'],
    };
    const request = {
      context,
      sources: [supporting, contrary],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    const verifier = createTreatmentClaimVerifier(db.database);
    const run = (
      text: string,
      citations = [supporting.reference, contrary.reference],
    ) =>
      evaluateTreatmentOutput(
        { claims: [{ text, citations }] },
        request,
        verifier,
        new AbortController().signal,
        [],
      );
    expect(
      await run(treatmentSafetyKo['treatmentSafety.possibleCondition']),
    ).toMatchObject({ status: 'validated' });
    expect(
      await run(treatmentSafetyKo['treatmentSafety.possibleCondition'], [
        supporting.reference,
      ]),
    ).toMatchObject({ status: 'withheld' });
    expect(
      await run(treatmentSafetyKo['treatmentSafety.reportedCondition']),
    ).toMatchObject({ status: 'withheld' });
    expect(await run('이 가능성은 확정된 진단이에요.')).toMatchObject({
      status: 'withheld',
    });
    await history.delete(contrary.reference.sourceId);
    expect(
      await run(treatmentSafetyKo['treatmentSafety.possibleCondition']),
    ).toMatchObject({ status: 'withheld' });
  } finally {
    db.close();
  }
});
