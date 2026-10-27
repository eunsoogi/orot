import { sharedUiCohorts, providerCohorts } from './ios-test-impact-owners.mjs';

/** New review dependents extend existing route/agent coverage rather than narrowing their prior contracts. */
export function encounterReviewTestImpact(path) {
  if (path.startsWith('apps/mobile/src/encounterReview/'))
    return {
      cohorts: ['recording-evidence', 'encounter-review-persistence', 'persistence'],
      reason: 'encounter-review-source',
    };
  if (path.startsWith('apps/mobile/src/agent/encounter/'))
    return {
      cohorts: [
        ...providerCohorts,
        'navigation',
        'core-ui',
        'recording-evidence',
        'encounter-review-persistence',
        'persistence',
      ],
      reason: 'encounter-review-agent-source',
    };
  if (path === 'apps/mobile/src/routes/RecordingReviewRoute.tsx')
    return {
      cohorts: [...sharedUiCohorts, 'encounter-review-persistence'],
      reason: 'encounter-review-route',
    };
  if (
    path === 'apps/mobile/e2e/encounterReviewPersistenceOperation.ts' ||
    path === 'apps/mobile/ios/OrotIntegrationTests/EncounterReviewPersistenceIntegrationTests.swift'
  )
    return { cohorts: ['encounter-review-persistence'], reason: 'encounter-review-native-test' };
  if (path === 'apps/mobile/ios/OrotUITests/EncounterReviewUITests.swift')
    return { cohorts: ['recording-evidence'], reason: 'encounter-review-native-ui-test' };
  return null;
}
