'use strict';

const {
  createLocalRecordQueryService,
  DEFAULT_MULTI_AGENT_BUDGET,
} = require('@orot/agent-runtime');
const { buildFixtureRecords } = require('../../../packages/eval/src/records');
const {
  createSyntheticVisitQuestionFixture,
} = require('../../../packages/eval/src/visitQuestionFixtures');
const {
  createBoundedVisitQuestionChunkBuilder,
} = require('../../../apps/mobile/src/agent/visitQuestions/boundedEvidenceChunks');
const {
  mapMemoryHitToVisitQuestionEvidence,
  mapRagHitToVisitQuestionEvidence,
} = require('../../../apps/mobile/src/agent/visitQuestions/evidence');
const {
  prepareVisitQuestionContext,
} = require('../../../apps/mobile/src/agent/visitQuestions/evidenceService');
const {
  createFixtureEvidenceData,
  createFixtureQueryStorage,
  createFixtureRepository,
} = require('./synthetic-fixture-adapters.cjs');
const { createSyntheticMemory } = require('./synthetic-memory.cjs');

const FIXTURE_SEED = 'orot-visit-questions-eval-v1';
const FIXTURE_NOW = '2030-04-26T00:00:00.000Z';

async function canonicalEvaluationCase(testCase, buildChunks, repository, memoryHit, prepared) {
  const personal = testCase.evidence.filter((item) => item.sourceKind === 'personal_record');
  const chunks = await buildChunks(repository, {
    identities: personal.map((item) => ({ kind: 'evidence_span', id: item.evidenceId })),
  });
  const chunksById = new Map(chunks.map((chunk) => [chunk.metadata.evidenceId, chunk]));
  const memory = mapMemoryHitToVisitQuestionEvidence(memoryHit);
  if (testCase.evidence.some((item) => item.sourceKind === 'reviewed_memory') && !memory) {
    throw new Error('The synthetic memory does not satisfy the app evidence contract.');
  }
  const evidence = await Promise.all(
    testCase.evidence.map(async (fixtureEvidence) => {
      if (fixtureEvidence.sourceKind === 'reviewed_memory') return memory.item;
      const chunk = chunksById.get(fixtureEvidence.evidenceId);
      if (!chunk) throw new Error('A seeded personal-record evidence span could not be rebuilt.');
      return (
        await mapRagHitToVisitQuestionEvidence(repository, {
          chunk,
          score: 0,
          lexicalRank: null,
          vectorRank: null,
        })
      ).item;
    }),
  );
  const fixtureMemory = testCase.evidence.find((item) => item.sourceKind === 'reviewed_memory');
  const expectedEvidenceIds = testCase.expected.expectedEvidenceIds.map((id) =>
    fixtureMemory?.evidenceId === id ? memory.item.evidenceId : id,
  );
  return {
    ...testCase,
    appointment: prepared.appointment,
    appointmentContext: prepared.appointmentContext,
    evidence,
    expected: { ...testCase.expected, expectedEvidenceIds },
  };
}

/** Prepares fixtures through the app context service, bounded chunk builder, and Rememori Store. */
async function makePreparedContext(
  testCase,
  fixture = createSyntheticVisitQuestionFixture(FIXTURE_SEED),
) {
  const selectedFixture = fixture.cases.find((item) => item.caseId === testCase.caseId);
  if (!selectedFixture) throw new Error('The evaluation case is not part of its fixture seed.');
  const records = buildFixtureRecords(fixture.fixtureId);
  // The app derives model-facing context from the selected appointment; carry each fixture query there.
  const appointment = { ...selectedFixture.appointment, note: selectedFixture.query };
  const repository = createFixtureRepository(records, appointment);
  const trace = {
    appointmentQueries: 0,
    chunkLoads: 0,
    memoryQueryServiceSearches: 0,
    memoryStoreSearches: 0,
    ragIndexCalls: 0,
    ragSearchCalls: 0,
  };
  const memory = await createSyntheticMemory(fixture.reviewedMemory, fixture.fixtureId, trace);
  try {
    const evidenceData = createFixtureEvidenceData(repository, trace);
    const buildChunks = createBoundedVisitQuestionChunkBuilder(async () => evidenceData);
    const queryService = createLocalRecordQueryService(
      createFixtureQueryStorage(appointment, trace),
      memory.queryReader,
    );
    const { createSyntheticRag } = require('./synthetic-rag.cjs');
    const prepared = await prepareVisitQuestionContext({
      now: FIXTURE_NOW,
      currentTime: () => FIXTURE_NOW,
      maxEvidenceItems: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems,
      queryService,
      store: memory.store,
      repository,
      rag: createSyntheticRag(repository, trace),
      buildChunks,
    });
    if (prepared.status !== 'ready') {
      throw new Error(`Synthetic app context was not ready: ${prepared.status}.`);
    }
    const evaluationCase = await canonicalEvaluationCase(
      selectedFixture,
      buildChunks,
      repository,
      memory.memoryHit,
      prepared,
    );
    return { prepared, evaluationCase, trace, close: memory.close };
  } catch (error) {
    await memory.close();
    throw error;
  }
}

module.exports = { makePreparedContext };
