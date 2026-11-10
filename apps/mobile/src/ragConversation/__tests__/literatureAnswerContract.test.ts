import { ragConversationTask } from '../task';

const evidence = {
  items: [
    {
      sourceKind: 'external_medical' as const,
      sourceId: 'europe-pmc',
      sourceRevision: 'r1',
      evidenceId: 'MED:1',
      evidenceRevision: 'e1',
      locator: {},
      effectiveTime: null,
      reviewState: 'unknown' as const,
      content:
        'Abstract: Adults were studied. Short sleep was associated with obesity (pooled OR 1.40, 95% CI 1.27-1.55).\nOriginal source: https://europepmc.org/article/MED/1',
    },
  ],
  coverage: [],
  conflicts: [],
};
const input = { request: 'Explain', evidence };

test('does not accept the observed unsupported free-text risk interpretation', () => {
  expect(
    ragConversationTask.validateResult(
      { answerKind: 'grounded', answer: '비만 위험도 40% 증가 (OR 1.40)' },
      input,
    ).status,
  ).not.toBe('valid');
});

test('does not let a legacy answer without answerKind evade literature validation', () => {
  const local = {
    ...evidence.items[0],
    sourceKind: 'personal_record' as const,
    sourceId: 'record',
    evidenceId: 'local',
    content: 'record',
  };
  expect(
    ragConversationTask.validateResult(
      { answer: '비만 위험도 40% 증가' },
      {
        ...input,
        evidence: { ...evidence, items: [evidence.items[0], local] },
      },
    ).status,
  ).not.toBe('valid');
});

test.each(['비만 위험 40% 증가', '비만 위험도 40% 증가'])(
  'does not accept unsupported literature prose alongside a personal record: %s',
  answer => {
    const personal = {
      ...evidence.items[0],
      sourceKind: 'personal_record' as const,
      sourceId: 'record',
      evidenceId: 'record-1',
      content: '수면 기록',
    };
    const result = ragConversationTask.validateResult(
      { answerKind: 'grounded', answer },
      {
        ...input,
        evidence: { ...evidence, items: [evidence.items[0], personal] },
      },
    );
    expect(result.status).not.toBe('valid');
  },
);

test('accepts a source-bound statistic and constructs its measure in the app', () => {
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [
        {
          evidenceId: 'MED:1',
          sourceRevision: 'r1',
          evidenceRevision: 'e1',
          populationSpan: 'Adults were studied.',
          resultSpan:
            'Short sleep was associated with obesity (pooled OR 1.40, 95% CI 1.27-1.55).',
          statisticSpan: 'pooled OR 1.40, 95% CI 1.27-1.55',
          limitationSpan: '',
          measure: 'odds_ratio',
          value: '1.40',
          confidenceInterval: '1.27-1.55',
        },
      ],
    },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.value.answer).toContain('오즈비 1.40');
});

test('preserves a qualitative abstract result without requiring an odds ratio', () => {
  const qualitative = {
    ...input,
    evidence: {
      ...evidence,
      items: [
        {
          ...evidence.items[0],
          content:
            'Abstract: Adults were studied. Sleep was associated with health outcomes.\nOriginal source: https://europepmc.org/article/MED/1',
        },
      ],
    },
  };
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [
        {
          evidenceId: 'MED:1',
          sourceRevision: 'r1',
          evidenceRevision: 'e1',
          populationSpan: 'Adults were studied.',
          resultSpan: 'Sleep was associated with health outcomes.',
          statisticSpan: '',
          limitationSpan: '',
          measure: 'qualitative',
          value: '',
          confidenceInterval: '',
        },
      ],
    },
    qualitative,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.value.answer).toContain(
      'Sleep was associated with health outcomes.',
    );
});

test('rejects a result excerpt that removes a qualifying negation', () => {
  const source = {
    ...evidence.items[0],
    content:
      'Abstract: Adults were studied. Sleep was not associated with obesity.\nOriginal source: https://europepmc.org/article/MED/1',
  };
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [
        {
          evidenceId: 'MED:1',
          sourceRevision: 'r1',
          evidenceRevision: 'e1',
          populationSpan: 'Adults were studied.',
          resultSpan: 'associated with obesity.',
          statisticSpan: '',
          limitationSpan: '',
          measure: 'qualitative',
          value: '',
          confidenceInterval: '',
        },
      ],
    },
    { request: 'Explain', evidence: { ...evidence, items: [source] } },
  );
  expect(result.status).not.toBe('valid');
});

test('does not treat a decimal point as the start of a new sentence', () => {
  const source = {
    ...evidence.items[0],
    content:
      'Abstract: Adults were studied. No benefit was found (p = 0.05).\nOriginal source: https://europepmc.org/article/MED/1',
  };
  const claim = {
    evidenceId: 'MED:1',
    sourceRevision: 'r1',
    evidenceRevision: 'e1',
    populationSpan: 'Adults were studied.',
    resultSpan: '05).',
    statisticSpan: '',
    limitationSpan: '',
    measure: 'qualitative',
    value: '',
    confidenceInterval: '',
  };
  expect(
    ragConversationTask.validateResult(
      { answerKind: 'grounded', answer: '', literature: [claim] },
      { request: 'Explain', evidence: { ...evidence, items: [source] } },
    ).status,
  ).not.toBe('valid');
});

test('rejects ambiguous duplicate source identities even if one copy matches', () => {
  const source = evidence.items[0];
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [
        {
          evidenceId: 'MED:1',
          sourceRevision: 'r1',
          evidenceRevision: 'e1',
          populationSpan: 'Adults were studied.',
          resultSpan:
            'Short sleep was associated with obesity (pooled OR 1.40, 95% CI 1.27-1.55).',
          statisticSpan: 'pooled OR 1.40, 95% CI 1.27-1.55',
          limitationSpan: '',
          measure: 'odds_ratio',
          value: '1.40',
          confidenceInterval: '1.27-1.55',
        },
      ],
    },
    {
      request: 'Explain',
      evidence: {
        ...evidence,
        items: [source, { ...source, content: 'Abstract: Different content.' }],
      },
    },
  );
  expect(result.status).not.toBe('valid');
});
