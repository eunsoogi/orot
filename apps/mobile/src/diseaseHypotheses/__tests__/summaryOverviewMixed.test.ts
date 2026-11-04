import { symptomSummaryTaskForProvider } from '../partitionedSymptomSummaryTask';
import { overviewSelectionSources } from '../summaryOverviewSelections';
import { evidence, reference } from '../taskTestSupport';

const task = symptomSummaryTaskForProvider('synthetic-cloud');
const content = (amount: number) =>
  `health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"heart_rate","effectiveAt":"2026-10-01T01:00:00Z","value":{"kind":"quantity","amount":${amount},"unit":"count/min"}}]}`;
const first = { ...reference, content: content(76) };

test('selects quantity groups alongside other personal records without accepting their invented prose', () => {
  const medication = {
    ...reference,
    sourceId: 'medication',
    evidenceId: 'medication',
    content:
      'health_overview: {"topic":"medications","records":[{"displayText":"예시약"}]}',
  };
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [first, medication] },
  };
  const selection = {
    recordSelections: [{ sourceId: first.evidenceId, rows: ['r0'] }],
  };
  expect(overviewSelectionSources(input)).toHaveLength(1);
  expect(task.validateResult(selection as never, input).status).toBe('valid');
  expect(
    task.validateResult(
      {
        ...selection,
        sections: [
          {
            title: '측정',
            summary: '심박수 999회',
            supportingEvidence: [first.evidenceId],
          },
        ],
      } as never,
      input,
    ).status,
  ).toBe('invalid');
});

test('does not choose between conflicting rows in different source groups', () => {
  const second = {
    ...first,
    sourceId: 'second',
    evidenceId: 'second',
    content: content(88),
  };
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [first, second] },
  };
  expect(
    task.validateResult(
      {
        recordSelections: [{ sourceId: first.evidenceId, rows: ['r0'] }],
      } as never,
      input,
    ).status,
  ).toBe('invalid');
  const both = task.validateResult(
    {
      recordSelections: [
        { sourceId: first.evidenceId, rows: ['r0'] },
        { sourceId: second.evidenceId, rows: ['r0'] },
      ],
    } as never,
    input,
  );
  expect(both.status).toBe('valid');
  if (both.status === 'valid')
    expect(
      both.value.hypotheses.every(section =>
        section.uncertainty.includes('서로 다른'),
      ),
    ).toBe(true);
});

test('retains a separately supported section when conflicting measurements are suppressed', () => {
  const second = {
    ...first,
    sourceId: 'second',
    evidenceId: 'second',
    content: content(88),
  };
  const publication = {
    ...reference,
    sourceKind: 'external_medical' as const,
    sourceId: 'paper',
    evidenceId: 'paper',
    content: 'Synthetic public context.',
  };
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [first, second, publication] },
  };
  const result = task.validateResult(
    {
      recordSelections: [{ sourceId: first.evidenceId, rows: ['r0'] }],
      sections: [
        {
          title: '일반 자료',
          summary: '심박수에 관한 일반 설명이에요.',
          supportingEvidence: ['paper'],
          contraryEvidence: [],
          uncertaintyNotes: [],
          missingData: [],
        },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.hypotheses).toHaveLength(1);
    expect(result.value.hypotheses[0]!.supportingEvidence[0]!.sourceKind).toBe(
      'external_medical',
    );
    expect(result.value.omittedUnsupportedContent).toBe(true);
  }
});

test('suppresses an overview reading contradicted by a current individual record', () => {
  const raw = {
    ...reference,
    sourceId: 'raw',
    evidenceId: 'raw',
    effectiveTime: '2026-10-01T01:00:00Z',
    content:
      'health_observation: {"concept":"heart_rate","value":{"kind":"quantity","amount":88,"unit":"count/min"}}',
  };
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [first, raw] },
  };
  expect(
    task.validateResult(
      {
        recordSelections: [{ sourceId: first.evidenceId, rows: ['r0'] }],
      } as never,
      input,
    ).status,
  ).toBe('invalid');
});

test('recognizes a conflicting quantity inside a mixed unsupported overview group', () => {
  const mixed = {
    ...reference,
    sourceId: 'mixed',
    evidenceId: 'mixed',
    content:
      'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"heart_rate","effectiveAt":"2026-10-01T01:00:00Z","value":{"kind":"quantity","amount":88,"unit":"count/min"}},{"kind":"health_observation","concept":"other"}]}',
  };
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [first, mixed] },
  };
  expect(
    task.validateResult(
      {
        recordSelections: [{ sourceId: first.evidenceId, rows: ['r0'] }],
      } as never,
      input,
    ).status,
  ).toBe('invalid');
});

test('omits an unselected conflicting raw section while retaining another selected measurement', () => {
  const measurements = {
    ...first,
    content:
      'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"heart_rate","effectiveAt":"2026-10-01T01:00:00Z","value":{"kind":"quantity","amount":76,"unit":"count/min"}},{"kind":"health_observation","concept":"body_mass","value":{"kind":"quantity","amount":68,"unit":"kg"}}]}',
  };
  const raw = {
    ...reference,
    sourceId: 'raw',
    evidenceId: 'raw',
    effectiveTime: '2026-10-01T01:00:00Z',
    content:
      'health_observation: {"concept":"heart_rate","value":{"kind":"quantity","amount":88,"unit":"count/min"}}',
  };
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [measurements, raw] },
  };
  const result = task.validateResult(
    {
      recordSelections: [{ sourceId: first.evidenceId, rows: ['r1'] }],
      sections: [
        {
          title: '심박수',
          summary: '심박수 88 count/min 기록이에요.',
          supportingEvidence: ['raw'],
          contraryEvidence: [],
          uncertaintyNotes: [],
          missingData: [],
        },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.hypotheses).toHaveLength(1);
    expect(result.value.hypotheses[0]!.summary).toContain('68');
    expect(result.value.hypotheses[0]!.summary).not.toContain('88');
    expect(result.value.omittedUnsupportedContent).toBe(true);
  }
});
