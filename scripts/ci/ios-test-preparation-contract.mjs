export const hostConnectionTest =
  'OrotIntegrationTests/HermesDomainIntegrationTests/testHostExecutesHermesOperations';

/** Preparation may run only the existing, non-mutating ios/JS connection case. It never substitutes for a suite. */
export function isIosHostPreparation(tests, phase) {
  if (phase === undefined) return false;
  if (phase !== 'prepare-ui' || tests.length !== 1 || tests[0] !== hostConnectionTest)
    throw new Error('Invalid integration host preparation selection');
  return true;
}
