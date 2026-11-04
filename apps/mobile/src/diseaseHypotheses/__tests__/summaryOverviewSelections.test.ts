import { symptomSummaryTaskForProvider } from '../partitionedSymptomSummaryTask';
import { overviewSelectionSources } from '../summaryOverviewSelections';
import { evidence, reference } from '../taskTestSupport';
const symptomSummaryTask = symptomSummaryTaskForProvider('synthetic-cloud');

const input = {
  request: '기록 요약',
  evidence: {
    ...evidence,
    items: [
      {
        ...reference,
        content:
          'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"step_count","value":{"kind":"quantity","amount":1234,"unit":"count"}},{"kind":"health_observation","concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}}]}',
      },
    ],
  },
};

test('retains a current source-bound row and omits an invalid selection without inventing a value', () => {
  const result = symptomSummaryTask.validateResult(
    {
      recordSelections: [
        { sourceId: reference.evidenceId, rows: ['r1', 'r999'] },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses).toHaveLength(1);
  expect(result.value.hypotheses[0]!.summary).toContain('76');
  expect(result.value.hypotheses[0]!.summary).not.toContain('999');
  expect(result.value.hypotheses[0]!.supportingEvidence).toEqual([reference]);
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('rejects model-authored prose or values and a source/key mismatch', () => {
  for (const value of [
    {
      recordSelections: [
        { sourceId: reference.evidenceId, rows: ['r1'], summary: '심박수 999' },
      ],
    },
    { recordSelections: [{ sourceId: 'other', rows: ['r1'] }] },
    { recordSelections: [{ sourceId: reference.evidenceId, rows: ['r999'] }] },
    {
      recordSelections: [
        {
          sourceId: reference.evidenceId,
          rows: ['r1'],
          limitationCodes: ['심박수 999'],
        },
      ],
    },
  ])
    expect(
      symptomSummaryTask.validateResult(value as never, input).status,
    ).toBe('invalid');
});

test('requires source-bound selections and never previews legacy prose for an eligible group', () => {
  const schema = symptomSummaryTask.createResultSchema!(input);
  expect(schema.required).toContain('recordSelections');
  const value = {
    sections: [
      {
        title: '심박수',
        summary: '심박수는 999회/분이에요.',
        supportingEvidence: [reference.evidenceId],
        contraryEvidence: [],
        uncertaintyNotes: [],
        missingData: [],
      },
    ],
  };
  expect(symptomSummaryTask.validateResult(value as never, input).status).toBe(
    'invalid',
  );
  expect(
    symptomSummaryTask.projectStreamedText!(
      JSON.stringify({
        type: 'result',
        value,
        citations: [reference.evidenceId],
      }),
      input,
    ),
  ).toBeUndefined();
});

test('requires all contradictory readings at one recorded instant and labels the difference', () => {
  const content =
    'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"heart_rate","effectiveAt":"2026-10-01T01:00:00Z","value":{"kind":"quantity","amount":76,"unit":"count/min"}},{"kind":"health_observation","concept":"heart_rate","effectiveAt":"2026-10-01T01:00:00Z","value":{"kind":"quantity","amount":88,"unit":"count/min"}}]}';
  const conflicting = {
    ...input,
    evidence: {
      ...input.evidence,
      items: [{ ...input.evidence.items[0]!, content }],
    },
  };
  expect(
    symptomSummaryTask.validateResult(
      {
        recordSelections: [{ sourceId: reference.evidenceId, rows: ['r0'] }],
      } as never,
      conflicting,
    ).status,
  ).toBe('invalid');
  const result = symptomSummaryTask.validateResult(
    {
      recordSelections: [
        { sourceId: reference.evidenceId, rows: ['r0', 'r1'] },
      ],
    } as never,
    conflicting,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses[0]!.summary).toContain('76');
  expect(result.value.hypotheses[0]!.summary).toContain('88');
  expect(result.value.hypotheses[0]!.uncertainty).toContain('서로 다른');
});

test('binds equal numeric values to their selected source concepts', () => {
  const equal = {
    ...input,
    evidence: {
      ...input.evidence,
      items: [
        {
          ...input.evidence.items[0]!,
          content: input.evidence.items[0]!.content.replace('1234', '76'),
        },
      ],
    },
  };
  const result = symptomSummaryTask.validateResult(
    {
      recordSelections: [{ sourceId: reference.evidenceId, rows: ['r1'] }],
    } as never,
    equal,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses[0]!.summary).toContain('심박수');
  expect(result.value.hypotheses[0]!.summary).not.toContain('걸음');
});

test('rejects aliases shared across source kinds and prototype-like concepts', () => {
  const duplicated = {
    ...input,
    evidence: {
      ...input.evidence,
      items: [
        ...input.evidence.items,
        {
          ...input.evidence.items[0]!,
          sourceKind: 'external_medical' as const,
        },
      ],
    },
  };
  const selected = {
    recordSelections: [{ sourceId: reference.evidenceId, rows: ['r1'] }],
  } as never;
  expect(overviewSelectionSources(duplicated)).toBeUndefined();
  expect(symptomSummaryTask.validateResult(selected, duplicated).status).toBe(
    'invalid',
  );
  const prototype = {
    ...input,
    evidence: {
      ...input.evidence,
      items: [
        {
          ...input.evidence.items[0]!,
          content:
            'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"constructor","value":{"kind":"quantity","amount":1}}]}',
        },
      ],
    },
  };
  expect(overviewSelectionSources(prototype)).toBeUndefined();
  expect(symptomSummaryTask.validateResult(selected, prototype).status).toBe(
    'invalid',
  );
});

test('rejects repeated sources even when the first entry selects no valid row', () => {
  const second = {
    ...input.evidence.items[0]!,
    evidenceId: 'other',
    sourceId: 'other',
  };
  const expanded = {
    ...input,
    evidence: { ...input.evidence, items: [...input.evidence.items, second] },
  };
  const result = symptomSummaryTask.validateResult(
    {
      recordSelections: [
        { sourceId: reference.evidenceId, rows: ['r999'] },
        { sourceId: reference.evidenceId, rows: ['r1'] },
      ],
    } as never,
    expanded,
  );
  expect(result.status).toBe('invalid');
});
