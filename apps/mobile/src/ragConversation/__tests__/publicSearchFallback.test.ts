import { acceptsLocalPublicSearchFallback } from '../publicSearchFallback';
import { publicSearchFailureGaps } from '../../aiFeatures/integration/publicSearchFailure';
import type { TaskResponderInput } from '@orot/agent-runtime';

const value = {
  answerKind: 'grounded',
  completion: 'partial',
  answer: '합성 기록 요약',
};
function input(): TaskResponderInput {
  return {
    request: '내 기록을 요약해 줘',
    evidence: {
      items: [
        {
          sourceKind: 'personal_record',
          sourceId: 'record',
          sourceRevision: '1',
          evidenceId: 'record-evidence',
          evidenceRevision: '1',
          locator: {},
          effectiveTime: null,
          reviewState: 'reviewed',
          content: '합성 기록',
        },
      ],
      conflicts: [],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: ['record'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
        {
          sourceKind: 'external_medical',
          searchedSourceIds: ['public-web'],
          gaps: [publicSearchFailureGaps.timeout],
          truncated: true,
          resultLimit: 1,
          returnedCount: 0,
        },
      ],
    },
  };
}

test('only app-owned public failure gaps permit a partial local answer', () => {
  expect(acceptsLocalPublicSearchFallback(value, input())).toBe(true);
  expect(
    acceptsLocalPublicSearchFallback(
      { ...value, completion: 'complete' },
      input(),
    ),
  ).toBe(false);
});

test.each([
  'unknown external gap',
  'local gap',
  'local truncation',
  'other destination',
  'conflict',
  'literature request',
  'external item',
  'missing local coverage',
])('rejects fallback with %s', kind => {
  const current = JSON.parse(JSON.stringify(input()));
  const coverage = current.evidence.coverage;
  if (kind === 'unknown external gap') coverage[1].gaps = ['unknown failure'];
  if (kind === 'local gap') coverage[0].gaps = ['missing records'];
  if (kind === 'local truncation') coverage[0].truncated = true;
  if (kind === 'other destination')
    coverage[1].searchedSourceIds = ['europe-pmc'];
  if (kind === 'conflict') current.evidence.conflicts = ['conflict'];
  if (kind === 'literature request')
    current.request = '수면 관련 논문을 설명해 줘';
  if (kind === 'external item')
    current.evidence.items[0].sourceKind = 'external_medical';
  if (kind === 'missing local coverage')
    coverage[0].searchedSourceIds = ['other'];
  expect(acceptsLocalPublicSearchFallback(value, current)).toBe(false);
});

test.each(['웹에서 수면 자료를 찾아 줘', 'Search online for sleep research'])(
  'does not replace an explicit public lookup with local facts: %s',
  request => {
    expect(
      acceptsLocalPublicSearchFallback(value, { ...input(), request }),
    ).toBe(false);
  },
);
