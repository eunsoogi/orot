import { ragConversationTask } from '../task';

const paper = {
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
};
const claim = {
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
};
const input = {
  request: '수면과 비만에 관한 연구를 설명해 주세요',
  evidence: { items: [paper], coverage: [], conflicts: [] },
};

test('does not label a study result as the population', () => {
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [{ ...claim, populationSpan: claim.resultSpan }],
    },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.completion).toBe('partial');
    expect(result.value.answer).toContain('선택한 문장의 역할');
    expect(result.value.answer).not.toContain('연구 대상 (초록 원문):');
  }
});

test('allows one source sentence to describe both the population and the result', () => {
  const sentence =
    'In adults, short sleep was associated with obesity (pooled OR 1.40, 95% CI 1.27-1.55).';
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [
        { ...claim, populationSpan: sentence, resultSpan: sentence },
      ],
    },
    {
      ...input,
      evidence: {
        ...input.evidence,
        items: [
          {
            ...paper,
            content: `Abstract: ${sentence}\nOriginal source: https://europepmc.org/article/MED/1`,
          },
        ],
      },
    },
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.answer.split(sentence)).toHaveLength(2);
  }
});

test('explains the population and association in Korean with the source measure', () => {
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer:
        '성인을 대상으로 한 연구에서 짧은 수면과 비만의 연관성이 보고됐어요.',
      literature: [claim],
    },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.answer).toContain('성인');
    expect(result.value.answer).toContain('연관');
    expect(result.value.answer).toContain('오즈비 1.40');
  }
});

test('answers a qualitative literature question with a source-bound Korean synthesis', () => {
  const sentence = 'Sleep was associated with health outcomes.';
  const qualitative = {
    ...paper,
    content: `Abstract: Adults were studied. ${sentence}\nOriginal source: https://europepmc.org/article/MED/1`,
  };
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '성인을 대상으로 수면과 건강 결과의 연관성이 보고됐어요.',
      literature: [
        {
          ...claim,
          resultSpan: sentence,
          statisticSpan: '',
          measure: 'qualitative',
          value: '',
          confidenceInterval: '',
        },
      ],
    },
    {
      ...input,
      request: '수면과 건강에 관한 연구를 설명해 주세요',
      evidence: { ...input.evidence, items: [qualitative] },
    },
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.literatureReferences).toEqual([
      expect.objectContaining({ evidenceId: 'MED:1', evidenceRevision: 'e1' }),
    ]);
    expect(result.value.answer).toContain('성인');
    expect(result.value.answer).toContain('연관');
  }
});

test('summarizes another supported qualitative topic without adding a causal claim', () => {
  const population = 'Older adults were studied.';
  const sentence = 'Smoking was associated with blood pressure.';
  const source = {
    ...paper,
    content: `Abstract: ${population} ${sentence}\nOriginal source: https://europepmc.org/article/MED/1`,
  };
  const result = ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [
        {
          ...claim,
          populationSpan: population,
          resultSpan: sentence,
          statisticSpan: '',
          measure: 'qualitative',
          value: '',
          confidenceInterval: '',
        },
      ],
    },
    {
      ...input,
      request: '흡연과 혈압 연구를 설명해 주세요',
      evidence: { ...input.evidence, items: [source] },
    },
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.answer).toContain('고령자');
    expect(result.value.answer).toContain('흡연');
    expect(result.value.answer).toContain('혈압');
    expect(result.value.answer).toContain('연관');
    expect(result.value.answer).not.toContain('원인');
  }
});

test.each([
  'The following was a hypothetical example.',
  'A previous study was quoted.',
])(
  'does not synthesize an association when the abstract has unsupported framing: %s',
  framing => {
    const population = 'Adults were studied.';
    const sentence = 'Sleep was associated with health outcomes.';
    const source = {
      ...paper,
      content: `Abstract: ${framing} ${population} ${sentence}\nOriginal source: https://europepmc.org/article/MED/1`,
    };
    const result = ragConversationTask.validateResult(
      {
        answerKind: 'grounded',
        answer: '',
        literature: [
          {
            ...claim,
            populationSpan: population,
            resultSpan: sentence,
            statisticSpan: '',
            measure: 'qualitative',
            value: '',
            confidenceInterval: '',
          },
        ],
      },
      { ...input, evidence: { ...input.evidence, items: [source] } },
    );
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.value.completion).toBe('partial');
      expect(result.value.answer).not.toContain(
        '연관성이 있다고 서술되어 있어요',
      );
    }
  },
);

test.each([
  [
    '아동을 대상으로 한 연구에서 짧은 수면과 비만의 연관성이 보고됐어요.',
    '아동',
  ],
  [
    '성인을 대상으로 한 연구에서 짧은 수면이 비만의 원인으로 확인됐어요.',
    '원인',
  ],
])(
  'does not display an unsupported Korean explanation: %s',
  (answer, unsupported) => {
    const result = ragConversationTask.validateResult(
      { answerKind: 'grounded', answer, literature: [claim] },
      input,
    );
    if (result.status === 'valid')
      expect(result.value.answer).not.toContain(unsupported);
  },
);
