import { validateLiteratureStatistics } from '../literatureStatistics';

const item = {
  sourceKind: 'external_medical' as const,
  sourceId: 'europe-pmc',
  sourceRevision: 'retrieved:1',
  evidenceId: 'MED:1',
  evidenceRevision: 'updated:1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
  content:
    'Abstract: Short sleep was associated with obesity (pooled OR 1.40, 95% CI 1.27-1.55).',
};
const claim = {
  evidenceId: 'MED:1',
  sourceRevision: 'retrieved:1',
  evidenceRevision: 'updated:1',
  span: 'pooled OR 1.40, 95% CI 1.27-1.55',
  measure: 'odds_ratio',
  value: '1.40',
  confidenceInterval: '1.27-1.55',
};

test('binds an exact statistic to its current source and renders the original measure', () => {
  expect(validateLiteratureStatistics([claim], [item])).toEqual({
    status: 'valid',
    statistics: [
      {
        measure: 'odds_ratio',
        value: '1.40',
        confidenceInterval: '1.27-1.55',
        confidenceLevel: 95,
      },
    ],
  });
});

test('numeric binding alone does not assert that a proposed estimate was observed', () => {
  const source = {
    ...item,
    content: `Abstract: The proposed estimate (${claim.span}) was not observed.`,
  };
  expect(validateLiteratureStatistics([claim], [source])).toEqual({
    status: 'valid',
    statistics: [
      {
        measure: 'odds_ratio',
        value: '1.40',
        confidenceInterval: '1.27-1.55',
        confidenceLevel: 95,
      },
    ],
  });
});

test('rejects a source-bound interval whose lower bound exceeds its upper bound', () => {
  const span = 'OR 1.40, 95% CI 1.55-1.27';
  expect(
    validateLiteratureStatistics(
      [{ ...claim, span, confidenceInterval: '1.55-1.27' }],
      [{ ...item, content: `Abstract: ${span}` }],
    ).status,
  ).toBe('invalid');
});

test.each(['log OR', 'ROR'])(
  'does not reinterpret a substring of %s as an odds ratio',
  prefix => {
    const source = {
      ...item,
      content: `Abstract: (${prefix} 1.40, 95% CI 1.27-1.55).`,
    };
    expect(
      validateLiteratureStatistics(
        [{ ...claim, span: 'OR 1.40, 95% CI 1.27-1.55' }],
        [source],
      ).status,
    ).toBe('invalid');
  },
);

test.each(['log OR', 'ROR'])(
  'rejects the originally reviewed %s metric-context example',
  prefix => {
    const span = 'OR 0.34, 95% CI 0.20-0.48';
    const source = {
      ...item,
      content: `Abstract: (${prefix} 0.34, 95% CI 0.20-0.48).`,
    };
    expect(
      validateLiteratureStatistics(
        [{ ...claim, span, value: '0.34', confidenceInterval: '0.20-0.48' }],
        [source],
      ).status,
    ).toBe('invalid');
  },
);

test.each([
  ['OR', 'odds_ratio'],
  ['RR', 'risk_ratio'],
  ['HR', 'hazard_ratio'],
])('requires a complete upper endpoint for %s', (label, measure) => {
  const longer = `${label} 1.40, 95% CI 1.27-1.555`;
  const shortened = `${label} 1.40, 95% CI 1.27-1.55`;
  const source = { ...item, content: `Abstract: (${longer}; I² = 20%).` };
  expect(
    validateLiteratureStatistics(
      [{ ...claim, measure, span: shortened }],
      [source],
    ).status,
  ).toBe('invalid');
  expect(
    validateLiteratureStatistics(
      [{ ...claim, measure, span: longer, confidenceInterval: '1.27-1.555' }],
      [source],
    ).status,
  ).toBe('valid');
});

test.each(['1.55e2', '1.55%'])(
  'does not truncate a numeric source token ending in %s',
  upper => {
    const source = {
      ...item,
      content: `Abstract: (OR 1.40, 95% CI 1.27-${upper}).`,
    };
    expect(
      validateLiteratureStatistics(
        [{ ...claim, span: 'OR 1.40, 95% CI 1.27-1.55' }],
        [source],
      ).status,
    ).toBe('invalid');
  },
);

test.each([
  { ...claim, measure: 'risk_ratio' },
  { ...claim, value: '1.41' },
  { ...claim, confidenceInterval: '1.27-1.56' },
  { ...claim, evidenceRevision: 'stale' },
  { ...claim, span: 'OR 1.40, 95% CI 1.27-1.56' },
])(
  'rejects a changed measure, value, interval, revision or source span',
  changed => {
    expect(validateLiteratureStatistics([changed], [item]).status).toBe(
      'invalid',
    );
  },
);

test.each([
  ['risk_ratio', 'RR'],
  ['hazard_ratio', 'HR'],
])('preserves the %s measure from its own span', (measure, abbreviation) => {
  const span = `${abbreviation} 1.40, 95% CI 1.27-1.55`;
  const source = { ...item, content: `Abstract: ${span}` };
  expect(
    validateLiteratureStatistics([{ ...claim, measure, span }], [source]),
  ).toEqual({
    status: 'valid',
    statistics: [
      {
        measure,
        value: '1.40',
        confidenceInterval: '1.27-1.55',
        confidenceLevel: 95,
      },
    ],
  });
});
