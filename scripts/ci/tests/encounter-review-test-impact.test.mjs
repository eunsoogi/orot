import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';
import { sharedUiCohorts, providerCohorts } from '../ios-test-impact-owners.mjs';
import { IOS_TEST_COHORT_NAMES } from '../ios-test-execution-plan.mjs';

const expand = (groups) =>
  IOS_TEST_COHORT_NAMES.filter((name) =>
    groups.some((group) => name === group || name.startsWith(group + '-')),
  );
test('production encounter composition and its native operation select their independent persistence proof', () => {
  for (const path of [
    'apps/mobile/src/encounterReview/service.ts',
    'apps/mobile/src/encounterReview/controller.ts',
    'apps/mobile/e2e/encounterReviewPersistenceOperation.ts',
    'apps/mobile/ios/OrotIntegrationTests/EncounterReviewPersistenceIntegrationTests.swift',
  ])
    assert.ok(iosTestImpactForPath(path).cohorts.includes('encounter-review-persistence'), path);
  assert.deepEqual(
    iosTestImpactForPath('apps/mobile/ios/OrotUITests/EncounterReviewUITests.swift').cohorts,
    ['recording-evidence'],
  );
});

test('new dependents extend all prior route and agent cohort selections', () => {
  const route = iosTestImpactForPath('apps/mobile/src/routes/RecordingReviewRoute.tsx').cohorts;
  for (const cohort of expand(sharedUiCohorts)) assert.ok(route.includes(cohort), cohort);
  assert.ok(route.includes('encounter-review-persistence'));
  const agent = iosTestImpactForPath('apps/mobile/src/agent/encounter/persistence.ts').cohorts;
  for (const cohort of expand([...providerCohorts, 'navigation', 'core-ui', 'recording-evidence']))
    assert.ok(agent.includes(cohort), cohort);
  assert.ok(agent.includes('persistence'));
  assert.ok(agent.includes('encounter-review-persistence'));
});
