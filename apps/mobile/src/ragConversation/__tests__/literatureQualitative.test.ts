import { summarizeSupportedAbstract } from '../literatureQualitative';

test.each([
  [
    'Children were studied.',
    'Physical activity was associated with sleep quality.',
    '아동',
    '신체 활동',
    '수면의 질',
  ],
  [
    'Adolescents were studied.',
    'Sedentary behavior was associated with depressive symptoms.',
    '청소년',
    '좌식 행동',
    '우울 증상',
  ],
])(
  'composes source-attributed statements for independent concepts',
  (population, result, group, exposure, outcome) => {
    const summary = summarizeSupportedAbstract(
      `${population} ${result}`,
      population,
      result,
    );
    expect(summary).toContain(group);
    expect(summary).toContain(exposure);
    expect(summary).toContain(outcome);
    expect(summary).toContain('연관성');
  },
);

test.each([
  'Physical activity was not associated with sleep quality.',
  'Physical activity might be associated with sleep quality.',
  'Physical activity caused sleep quality.',
  'Reduced physical activity was associated with sleep quality.',
  'Physical activity was associated with sleep quality in a previous study.',
])(
  'does not infer a supported relation from an unconsumed clause: %s',
  result => {
    const population = 'Adults were studied.';
    expect(
      summarizeSupportedAbstract(`${population} ${result}`, population, result),
    ).toBeUndefined();
  },
);

test('does not ignore preceding or following framing', () => {
  const population = 'Adults were studied.';
  const result = 'Physical activity was associated with sleep quality.';
  expect(
    summarizeSupportedAbstract(
      `This was a hypothetical example. ${population} ${result}`,
      population,
      result,
    ),
  ).toBeUndefined();
  expect(
    summarizeSupportedAbstract(
      `${population} ${result} This was not observed.`,
      population,
      result,
    ),
  ).toBeUndefined();
});

test.each([
  'Constructor was associated with obesity.',
  'Sleep was associated with __proto__.',
])(
  'does not treat inherited object properties as medical concepts: %s',
  result => {
    const population = 'Adults were studied.';
    expect(
      summarizeSupportedAbstract(`${population} ${result}`, population, result),
    ).toBeUndefined();
  },
);

test('recognizes a bound statistic without consuming qualifiers or negation', () => {
  const population = 'Adults were studied.';
  const statistic = 'OR 1.40, 95% CI 1.27-1.55';
  const positive = `Short sleep was associated with obesity (${statistic}).`;
  expect(
    summarizeSupportedAbstract(
      `${population} ${positive}`,
      population,
      positive,
      statistic,
    ),
  ).toContain('연관성');
  const negated = `Short sleep was not associated with obesity (${statistic}).`;
  expect(
    summarizeSupportedAbstract(
      `${population} ${negated}`,
      population,
      negated,
      statistic,
    ),
  ).toBeUndefined();
  const proposed = `Short sleep was associated with obesity (${statistic}) was not observed.`;
  expect(
    summarizeSupportedAbstract(
      `${population} ${proposed}`,
      population,
      proposed,
      statistic,
    ),
  ).toBeUndefined();
});
