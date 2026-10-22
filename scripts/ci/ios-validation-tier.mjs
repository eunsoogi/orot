import { IOS_TEST_COHORT_NAMES } from './ios-test-execution-plan.mjs';

const TIERS = new Set(['pr', 'main-impact', 'full', 'candidate', 'diagnostic', 'unclassified']);

/** The caller passes a candidate number only after live PR identity verification; breadth never promotes a tier. */
export function iosValidationTierForEvent(eventName, ref, candidatePrNumber = '') {
  if (eventName === 'pull_request') return 'pr';
  if (eventName === 'push' && ref === 'refs/heads/main') return 'main-impact';
  if (eventName === 'workflow_dispatch') {
    if (typeof candidatePrNumber === 'string' && candidatePrNumber !== '') return 'candidate';
    return ref === 'refs/heads/main' ? 'full' : 'diagnostic';
  }
  if (eventName === 'schedule' && ref === 'refs/heads/main') return 'full';
  return 'unclassified';
}

export function isIosValidationTier(value) {
  return TIERS.has(value);
}

export function validateFullIosSelection(selectedCohorts, oauthRequired) {
  if (
    !Array.isArray(selectedCohorts) ||
    JSON.stringify(selectedCohorts) !== JSON.stringify(IOS_TEST_COHORT_NAMES)
  )
    throw new Error('Full validation requires the canonical complete cohort inventory');
  if (oauthRequired !== true) throw new Error('Full validation requires OAuth execution');
}
