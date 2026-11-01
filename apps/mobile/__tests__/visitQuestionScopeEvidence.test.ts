import {
  acceptScopeContext,
  acceptScopeEvidence,
  beginScopeObservation,
  expectedSymptoms,
} from '../e2e/visitQuestionScopeGuard';
import { visitQuestionCitationKey } from '../src/agent/visitQuestions/evidence';

test('allows each exact synthetic symptom and rejects mismatched source provenance', () => {
  const token = beginScopeObservation(jest.fn());
  acceptScopeContext(token);
  for (const id of expectedSymptoms) {
    const item = {
      sourceKind: 'personal_record',
      sourceId: id,
      sourceRevision: 'r',
      evidenceId: id,
      evidenceRevision: 'r',
      locator: { kind: 'structured_record', recordId: id },
      effectiveTime: null,
      reviewState: 'unreviewed',
      content: 'synthetic',
    } as const;
    const metadata = {
      recordKind: 'symptom_entry',
      evidenceRecordId: id,
      sourceRecordIds: [id],
    };
    const collection = {
      batch: { items: [item] },
      metadataByCitation: new Map([[visitQuestionCitationKey(item), metadata]]),
    } as never;
    expect(() => acceptScopeEvidence(token, collection)).not.toThrow();
    expect(() =>
      acceptScopeEvidence(token, {
        batch: { items: [item] },
        metadataByCitation: new Map([
          [
            visitQuestionCitationKey(item),
            {
              ...metadata,
              sourceRecordIds: [expectedSymptoms.find(other => other !== id)!],
            },
          ],
        ]),
      } as never),
    ).toThrow();
  }
});
