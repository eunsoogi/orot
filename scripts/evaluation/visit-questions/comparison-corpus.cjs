'use strict';

const { buildFixtureRecords } = require('../../../packages/eval/src/records');
const {
  createFixtureRepository,
  createFixtureEvidenceData,
} = require('./synthetic-fixture-adapters.cjs');
const {
  createBoundedVisitQuestionChunkBuilder,
} = require('../../../apps/mobile/src/agent/visitQuestions/boundedEvidenceChunks');
const {
  mapRagHitToVisitQuestionEvidence,
} = require('../../../apps/mobile/src/agent/visitQuestions/evidence');

/** Rebuild the entire fixture corpus, including distractors, through the app's provenance mapping. */
async function buildComparisonCorpus(fixture, context) {
  const repository = createFixtureRepository(
    buildFixtureRecords(fixture.fixtureId),
    context.prepared.appointment,
  );
  const data = createFixtureEvidenceData(repository, { chunkLoads: 0 });
  const buildChunks = createBoundedVisitQuestionChunkBuilder(async () => data);
  const identities = [...repository.values.entries()]
    .filter(([kind]) => kind !== 'source_record')
    .flatMap(([kind, records]) => records.map(({ id }) => ({ kind, id })));
  const chunks = await buildChunks(repository, { identities });
  const mapped = await Promise.all(
    chunks.map((chunk) =>
      mapRagHitToVisitQuestionEvidence(repository, {
        chunk,
        score: 0,
        lexicalRank: null,
        vectorRank: null,
      }),
    ),
  );
  const personal = mapped.filter(Boolean).map(({ item }) => item);
  const memory = context.evaluationCase.evidence.filter(
    (item) => item.sourceKind === 'reviewed_memory',
  );
  // Every case gets the same reviewed memory, including cases whose expected answer does not cite it.
  if (memory.length === 0)
    throw new Error('Comparison corpus requires the canonical reviewed memory.');
  return [...new Map([...personal, ...memory].map((item) => [item.evidenceId, item])).values()];
}

module.exports = { buildComparisonCorpus };
