'use strict';

const path = require('node:path');
const { toLangSmithOutput } = require('./privacy');
const { getWorkflowSourceRoot } = require('./source-root.cjs');
const { makePreparedContext, referenceMapForEvidence } = require('./synthetic-evidence.cjs');
const { createScriptedProvider, responseFor } = require('./scripted-provider.cjs');

const FIXTURE_SEED = 'orot-visit-questions-eval-v1';
const repositoryRoot = path.resolve(__dirname, '../../..');

/** Runs the #30 graph and records its result without replacing below-target rubric scores. */
async function runSyntheticCase(testCase) {
  const workflowSourceRoot = getWorkflowSourceRoot(repositoryRoot);
  const workflowRoot = path.join(workflowSourceRoot, 'apps/mobile/src/agent/visitQuestions');
  const { runVisitQuestionWorkflow } = require(path.join(workflowRoot, 'workflow'));
  const { createVisitQuestionEvidenceAliases } = require(
    path.join(workflowRoot, 'evidenceAliases'),
  );
  const { prepared, supplementalBatch } = makePreparedContext(testCase);
  const aliases = createVisitQuestionEvidenceAliases(prepared.evidence.batch);
  aliases.aliasBatch(supplementalBatch);
  const references = referenceMapForEvidence(testCase, aliases);
  const scripted = createScriptedProvider(testCase, responseFor(testCase, references));
  const selection = {
    providerId: scripted.provider.id,
    modelId: 'synthetic-scripted-v1',
  };
  const startedAt = process.hrtime.bigint();
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [
      {
        provider: scripted.provider,
        modelId: selection.modelId,
        displayName: scripted.provider.displayName,
        privacyBoundary: 'on-device',
        availability: { status: 'available' },
      },
    ],
  });
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const expectedCalls = testCase.expected.resultMode === 'suggestions' ? 3 : 1;
  if (scripted.callCount !== expectedCalls) {
    throw new Error(
      `The scripted test adapter expected ${expectedCalls} calls but received ${scripted.callCount}; turns=${scripted.providerTurns.join(',')}.`,
    );
  }

  return toLangSmithOutput(result, {
    providerMode: 'test-adapter',
    latencyMs,
    tokenUsage: null,
  });
}

module.exports = { FIXTURE_SEED, runSyntheticCase };
