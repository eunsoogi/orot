'use strict';

const path = require('node:path');
const { toLangSmithOutput } = require('./privacy');
const { getVisitQuestionProviderConfig } = require('./provider-config.cjs');
const { createOpenAIChatCompletionsProvider } = require('./openai-api-provider.cjs');
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
  const providerConfig = getVisitQuestionProviderConfig(process.env);
  let selectedProvider;
  if (providerConfig.mode === 'test-adapter') {
    const scripted = createScriptedProvider(testCase, responseFor(testCase, references));
    selectedProvider = {
      provider: scripted.provider,
      providerTurns: scripted.providerTurns,
      // Keep this getter live; spreading the adapter would snapshot its zero count before execution.
      get callCount() {
        return scripted.callCount;
      },
      getTokenUsage: () => null,
    };
  } else {
    selectedProvider = createOpenAIChatCompletionsProvider(providerConfig);
  }
  const selection = {
    providerId: selectedProvider.provider.id,
    modelId: providerConfig.model,
  };
  const startedAt = process.hrtime.bigint();
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [
      {
        provider: selectedProvider.provider,
        modelId: selection.modelId,
        displayName: selectedProvider.provider.displayName,
        privacyBoundary: providerConfig.allowRemoteProcessing
          ? 'selected-context-remote'
          : 'on-device',
        availability: { status: 'available' },
      },
    ],
    ...(providerConfig.allowRemoteProcessing
      ? {
          recipient: 'Synthetic evaluation account',
          confirmConsent: async () => true,
        }
      : {}),
  });
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  if (providerConfig.mode === 'test-adapter') {
    const expectedCalls = testCase.expected.resultMode === 'suggestions' ? 3 : 1;
    if (selectedProvider.callCount !== expectedCalls) {
      throw new Error(
        `The scripted test adapter expected ${expectedCalls} calls but received ${selectedProvider.callCount}; turns=${selectedProvider.providerTurns.join(',')}.`,
      );
    }
  }

  return toLangSmithOutput(result, {
    providerMode: providerConfig.mode,
    latencyMs,
    tokenUsage: selectedProvider.getTokenUsage(),
  });
}

module.exports = { FIXTURE_SEED, runSyntheticCase };
