/** Feature-local changes run the production App review journeys; shared agent dependencies retain their broader mapping. */
export function healthReviewTestImpact(path) {
  if (path.startsWith('apps/mobile/src/healthReview/'))
    return { cohorts: ['health-review-ui'], reason: 'health-review-source' };
  if (path === 'apps/mobile/e2e/healthReviewProbeEntry.tsx')
    return { cohorts: ['health-review-ui'], reason: 'health-review-probe' };
  return null;
}
