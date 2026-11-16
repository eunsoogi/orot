'use strict';

const { createSyntheticVisitQuestionFixture } = require('../../../packages/eval/src');
const {
  visitQuestionCitationKey,
} = require('../../../apps/mobile/src/agent/visitQuestions/evidence');

/** Curated synthetic snapshot, not a database/retrieval benchmark. Uses the real workflow downstream. */
async function makeDecisionContext(testCase) {
  const fixture = createSyntheticVisitQuestionFixture('decision-quality-only');
  const appointment = { ...fixture.cases[0].appointment, note: testCase.query };
  const appointmentContext = { ...fixture.cases[0].appointmentContext, note: testCase.query };
  const collect = (kind = 'personal_record') => {
    const items = testCase.evidence.filter((item) => item.sourceKind === kind);
    return {
      batch: {
        items,
        conflicts: [],
        coverage: [
          {
            sourceKind: kind,
            searchedSourceIds: items.map((item) => item.sourceId),
            gaps: [],
            truncated: false,
            resultLimit: 5,
            returnedCount: items.length,
          },
        ],
      },
      metadataByCitation: new Map(
        items.map((item) => [
          visitQuestionCitationKey(item),
          {
            sourceRecordIds: [item.sourceId],
            sourceRecordRevisions: [],
            sourceDates: [],
          },
        ]),
      ),
      memoryStatus: 'available',
    };
  };
  return {
    prepared: {
      status: 'ready',
      appointment,
      appointmentRevision: 'synthetic-current',
      appointmentContext,
      query: testCase.query,
      evidence: {
        batch: { items: [], coverage: [], conflicts: [] },
        metadataByCitation: new Map(),
        memoryStatus: 'not_searched',
      },
      searchEvidence: async (_query, _limit, kind) => collect(kind),
      revalidateEvidence: async () => true,
      reloadPersonalEvidence: async (item) => item,
    },
    evaluationCase: { ...testCase, appointment, appointmentContext },
    trace: { boundary: 'curated-synthetic-snapshot' },
    close: async () => {},
  };
}
module.exports = { makeDecisionContext };
