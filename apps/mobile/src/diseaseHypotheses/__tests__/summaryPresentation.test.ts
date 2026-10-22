import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

const alias = 'e21';
const input = {
  request: '합성 기록 요약',
  evidence: {
    ...evidence,
    items: [
      {
        ...reference,
        evidenceId: alias,
        content:
          'health_observation: {"concept":"step_count","value":{"kind":"quantity","amount":21,"unit":"count"}}',
      },
    ],
  },
};
function validate(summary: string, contraryEvidence: string[] = []) {
  return symptomSummaryTask.validateResult(
    {
      sections: [
        hypothesis({
          summary,
          supportingEvidence: [alias],
          contraryEvidence,
          uncertainty: '',
          missingData: [],
        }),
      ],
    },
    input,
  );
}

test('displays steps as steps instead of measurement occurrences', () => {
  expect(validate('걸음 수는 21회 측정됨.').status).toBe('invalid');
  expect(validate('걸음 수는 21걸음으로 기록됐어요.').status).toBe('valid');
});

test('removes only duplicate display markers whose exact IDs remain bound in citation arrays', () => {
  const result = validate('걸음 수는 21걸음으로 기록됐어요. (e21)');
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses[0]?.summary).toBe(
    '걸음 수는 21걸음으로 기록됐어요.',
  );
  expect(result.value.hypotheses[0]?.supportingEvidence[0]?.evidenceId).toBe(
    alias,
  );
});

test('never counts a citation ID digit as the measured quantity', () => {
  expect(validate('걸음 수 기록 (e21)').status).toBe('invalid');
});

test('does not silently remove an unbound inline citation marker', () => {
  expect(validate('걸음 수는 21걸음이에요. (e999)').status).toBe('invalid');
});

test('does not invent opposing evidence in a factual record summary', () => {
  expect(validate('걸음 수는 21걸음이에요.', [alias]).status).toBe('invalid');
});

test('allows absent optional limitations without accepting an explicit untranslated placeholder', () => {
  const minimal = {
    title: '걸음 수',
    summary: '걸음 수는 21걸음이에요.',
    supportingEvidence: [alias],
    contraryEvidence: [],
  };
  const result = symptomSummaryTask.validateResult(
    { sections: [minimal] },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses[0]).toMatchObject({
    uncertainty: '',
    missingData: [],
  });
  expect(
    symptomSummaryTask.validateResult(
      { sections: [{ ...minimal, uncertainty: 'None' }] },
      input,
    ).status,
  ).toBe('invalid');
  expect(
    symptomSummaryTask.validateResult(
      { sections: [{ ...minimal, uncertainty: null }] },
      input,
    ).status,
  ).toBe('invalid');
  expect(
    symptomSummaryTask.validateResult(
      { sections: [{ ...minimal, uncertainty: '   ' }] },
      input,
    ).status,
  ).toBe('invalid');
});
