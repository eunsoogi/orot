import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { symptomSummaryTask } from '../symptomSummaryTask';
import {
  partitionedSymptomSummaryTask,
  symptomSummaryTaskForProvider,
} from '../partitionedSymptomSummaryTask';
import type { TaskResponderInput } from '@orot/agent-runtime';

test('only the on-device provider uses source-group generation', () => {
  expect(symptomSummaryTaskForProvider(APPLE_PROVIDER_ID)).toBe(
    partitionedSymptomSummaryTask,
  );
  expect(symptomSummaryTaskForProvider('openai')).toBe(symptomSummaryTask);
});

test('merges every validated section unchanged and deduplicates coverage notes without inventing prose', () => {
  const first = {
    sections: [
      {
        title: '합성 개인 기록',
        summary: '합성 관찰 요약',
        supportingEvidence: ['p1'],
      },
    ],
    coverageNotes: ['no_symptom_entries_in_supplied_records'],
  };
  const second = {
    sections: [
      {
        title: '합성 의학 설명',
        summary: '합성 문헌 설명',
        supportingEvidence: ['m1'],
      },
    ],
    coverageNotes: ['no_symptom_entries_in_supplied_records'],
  };
  expect(
    partitionedSymptomSummaryTask.finalResultPartition!.mergeValues(
      [first, second],
      {} as TaskResponderInput,
    ),
  ).toEqual({
    sections: [...first.sections, ...second.sections],
    coverageNotes: first.coverageNotes,
  });
  expect(first.sections).toHaveLength(1);
  expect(second.sections).toHaveLength(1);
});

test('limits group sections by supplied sources and keeps citation guidance restricted to that group', () => {
  const items = ['p1', 'p2'].map(evidenceId => ({
    sourceKind: 'personal_record' as const,
    sourceId: evidenceId,
    sourceRevision: '1',
    evidenceId,
    evidenceRevision: '1',
    effectiveTime: null,
    locator: { recordId: evidenceId },
    reviewState: 'reviewed' as const,
    content: 'Synthetic facts',
  }));
  const input: TaskResponderInput = {
    request: '합성 요약',
    evidence: { items, coverage: [], conflicts: [] },
    resultPartition: { sourceKind: 'personal_record', index: 0, total: 2 },
  };
  expect(
    partitionedSymptomSummaryTask.createResultSchema!(input),
  ).toMatchObject({
    properties: { sections: { minItems: 1, maxItems: 2 } },
  });
  expect(symptomSummaryTask.createResultSchema!(input)).toMatchObject({
    properties: { sections: { maxItems: 8 } },
  });
});
