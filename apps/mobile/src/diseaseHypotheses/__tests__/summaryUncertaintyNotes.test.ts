import { symptomSummaryTask } from '../symptomSummaryTask';
import { createSymptomSummarySchema } from '../symptomSummarySchema';
import { evidence, hypothesis, reference } from '../taskTestSupport';

function validate(notes: unknown, extra = {}) {
  const section = Object.fromEntries(
    Object.entries(
      hypothesis({
        supportingEvidence: [reference.evidenceId],
        missingData: [],
      }),
    ).filter(([key]) => key !== 'uncertainty'),
  );
  return symptomSummaryTask.validateResult(
    { sections: [{ ...section, uncertaintyNotes: notes, ...extra }] } as never,
    { request: '합성 요약', evidence },
  );
}

test('represents no asserted limitation with an empty array while retaining the saved text contract', () => {
  const result = validate([]);
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses[0]?.uncertainty).toBe('');
  const limited = validate([
    '조회한 일부 기록만으로 전체 경과를 알 수는 없어요.',
  ]);
  expect(limited.status).toBe('valid');
  if (limited.status === 'valid')
    expect(limited.value.hypotheses[0]?.uncertainty).toBe(
      '조회한 일부 기록만으로 전체 경과를 알 수는 없어요.',
    );
});

test.each([
  { notes: ['None'] },
  { notes: [null] },
  { notes: ['   '] },
  { notes: 'None' },
  { notes: null },
  { notes: ['가'.repeat(501)] },
  { notes: ['가'.repeat(250), '나'.repeat(250)] },
  { notes: ['가', '나', '다', '라'] },
  { notes: ['한계가 있어요.', 'None'] },
])('rejects malformed or untranslated notes $notes', ({ notes }) => {
  expect(validate(notes).status).toBe('invalid');
});

test('does not resolve contradictory old and new limitation fields by silently dropping one', () => {
  expect(validate([], { uncertainty: 'None' }).status).toBe('invalid');
});

test('native guidance offers an optional notes array instead of a scalar placeholder', () => {
  const schema = JSON.parse(JSON.stringify(createSymptomSummarySchema()));
  const fields = schema.properties.sections.items.properties;
  expect(fields.uncertainty).toBeUndefined();
  expect(fields.uncertaintyNotes).toMatchObject({
    type: 'array',
    maxItems: 3,
    items: { type: 'string' },
  });
});
