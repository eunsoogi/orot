import { runEncounterReviewFixture } from '../src/encounterReview/nativeFixture';

/** Native operation dispatch retains the production discovery/controller/service path and real encrypted storage. */
export function runEncounterReviewPersistenceOperation(
  mode: unknown,
  fixture: unknown,
) {
  return runEncounterReviewFixture(mode, fixture);
}
