import { createFixtureId } from './identity';
import { buildFixtureExpectations } from './expectations';
import { buildFixtureRecords } from './records';
export {
  createSyntheticVisitQuestionFixture,
  type SyntheticVisitQuestionCase,
  type SyntheticVisitQuestionEvidence,
  type SyntheticVisitQuestionFixture,
} from './visitQuestionFixtures';
import type { SyntheticHealthFixture } from './types';

export type {
  EvaluationCase,
  EvidenceRelation,
  ExpectedEvidence,
  SafetyExpectation,
  SyntheticHealthFixture,
  TranscriptRevision,
} from './types';

export const SYNTHETIC_DATA_NOTICE =
  'Synthetic evaluation data only; no real personal data and no clinical validation.';

export function createSyntheticHealthFixture(seed: string): SyntheticHealthFixture {
  const fixtureId = createFixtureId(seed);
  return {
    fixtureId,
    disclaimer: SYNTHETIC_DATA_NOTICE,
    ...buildFixtureRecords(fixtureId),
    ...buildFixtureExpectations(fixtureId),
  };
}
