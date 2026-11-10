import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import type { TreatmentExplanationRequest } from '../interfaces';
import { createTreatmentClaimVerifier } from '../treatmentClaimVerifier';
import { evaluateTreatmentOutput } from '../treatmentSafetyBoundary';

test('verifies bounded claims against the original record and rejects correction or unsupported conclusions', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const history = createManualHistoryRepository(db.database);
    const entry = await history.create({
      kind: 'diagnosis_history',
      title: 'Synthetic',
      details: 'Reported history',
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
    const condition = {
      status: 'user_reported' as const,
      source: reference,
      record,
      uncertainty: 'Date unknown',
    };
    const request = {
      context: {
        version: 1,
        conditions: [condition],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: ['Date'],
        conflicts: [],
      },
      sources: [{ reference, records: [record] }],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    const verifier = createTreatmentClaimVerifier(db.database);
    const run = (text: string, input = request, citations = [reference]) =>
      evaluateTreatmentOutput(
        { claims: [{ text, citations }] },
        input,
        verifier,
        new AbortController().signal,
        [],
      );
    expect(
      await run(treatmentSafetyKo['treatmentSafety.reportedCondition']),
    ).toMatchObject({ status: 'validated' });
    expect(
      await run(
        treatmentSafetyKo['treatmentSafety.generalOptions'],
        request,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
    expect(
      await run(
        treatmentSafetyKo['treatmentSafety.discussOptions'],
        request,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
    expect(
      await run(
        treatmentSafetyKo['treatmentSafety.benefitsRisks'],
        request,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
    expect(
      await run(treatmentSafetyKo['treatmentSafety.recordQuestion']),
    ).toMatchObject({ status: 'validated' });
    expect(
      await run(
        treatmentSafetyKo['treatmentSafety.recordQuestion'],
        request,
        [],
      ),
    ).toMatchObject({ status: 'withheld' });
    expect(
      await run(treatmentSafetyKo['treatmentSafety.generalOptions']),
    ).toMatchObject({ status: 'withheld' });
    expect(
      await run(treatmentSafetyKo['treatmentSafety.clinicianCondition']),
    ).toMatchObject({ status: 'withheld' });
    for (const text of [
      '이 약은 임신 중 안전해요.',
      '치료하면 완치돼요.',
      '이 약은 다른 약과 상호작용하지 않아요.',
      '이 치료는 어린이에게 안전해요.',
      '두 진료 계획이 다르면 첫 번째 계획만 따르세요.',
      '오래된 처방 기록은 지금 이 약을 복용한다는 뜻이에요.',
      '공개 논문이 이 사람에게 치료 효과를 보장해요.',
      '기록에 따르면 이 치료가 가장 좋아요.',
      '치료를 시작하세요.',
    ]) {
      expect(await run(text)).toMatchObject({ status: 'withheld' });
    }
    const forged = {
      ...request,
      context: {
        ...request.context,
        conditions: [{ ...condition, status: 'clinician_recorded' as const }],
      },
    };
    expect(
      await run(
        treatmentSafetyKo['treatmentSafety.clinicianCondition'],
        forged,
      ),
    ).toMatchObject({ status: 'withheld' });
    await history.correct(entry.id, {
      kind: 'diagnosis_history',
      title: 'Changed',
      details: 'Updated',
      effectiveDate: { status: 'unknown' },
    });
    expect(
      await run(treatmentSafetyKo['treatmentSafety.reportedCondition']),
    ).toMatchObject({ status: 'withheld' });
  } finally {
    db.close();
  }
});
