import { MemorySaver } from '@langchain/langgraph/web';
import type {
  HealthReviewOptions,
  HealthReviewPort,
  HealthReviewSafety,
} from '../src/health-review/contracts';
import type { EvidenceBatch } from '../src/multiAgent/contracts';

/** Shared deterministic evidence and policy port for mode-routing regression tests. */
export const bloodPressureMissing: HealthReviewSafety = {
  policyVersion: '1.0.0',
  category: 'insufficient_information',
  matchedRuleIds: [],
  requiredActions: ['provide_required_information'],
  missingInputs: ['blood_pressure_reading'],
};

export const completeEvidence: EvidenceBatch = {
  items: [
    {
      sourceKind: 'personal_record',
      sourceId: 'source',
      sourceRevision: '1',
      evidenceId: 'evidence',
      evidenceRevision: '1',
      locator: { kind: 'test' },
      effectiveTime: null,
      reviewState: 'unknown',
      content: 'synthetic observation',
    },
  ],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['source'],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

export function healthReviewModeFixture(batch: EvidenceBatch = completeEvidence) {
  const assessSafety = jest.fn(async (input: unknown) => {
    const status = (input as { symptomAssessment?: { status?: string } } | null)?.symptomAssessment
      ?.status;
    return status === 'no_new_or_concerning_symptoms'
      ? bloodPressureMissing
      : {
          ...bloodPressureMissing,
          missingInputs: ['explicit_symptom_assessment'],
        };
  });
  const collect = jest.fn(async () => batch);
  const explain = jest.fn(async () => ({
    observedChanges: [{ text: '기록된 변화를 확인했어요.', evidenceIds: ['evidence'] }],
    unresolvedItems: [],
    questions: ['추가로 확인할 내용이 있나요?'],
  }));
  const port: HealthReviewPort = {
    assessSafety,
    collect,
    references: (value) => value.items.map(({ content: _content, ...reference }) => reference),
    revalidate: async () => true,
    explain,
  };
  const options = {
    threadId: 'thread',
    sourceId: 'source',
    safetyInput: {
      symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
    },
    port,
    checkpointer: new MemorySaver(),
  } satisfies Omit<HealthReviewOptions, 'mode' | 'clarification'>;
  return { options, port, assessSafety, collect, explain };
}
