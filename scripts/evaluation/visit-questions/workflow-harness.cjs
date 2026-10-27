'use strict';

const path = require('node:path');
const { toLangSmithOutput } = require('./privacy');
const { getVisitQuestionProviderConfig } = require('./provider-config.cjs');
const { createOpenAIChatCompletionsProvider } = require('./openai-api-provider.cjs');
const { getWorkflowSourceRoot } = require('./source-root.cjs');
const { makePreparedContext } = require('./synthetic-evidence.cjs');
const { createScriptedProvider } = require('./scripted-provider.cjs');

const FIXTURE_SEED = 'orot-visit-questions-eval-v1';
const repositoryRoot = path.resolve(__dirname, '../../..');

/** Runs the visit-question workflow without replacing below-target rubric scores. */
async function runSyntheticCase(testCase, testOverrides = {}) {
  const workflowSourceRoot = getWorkflowSourceRoot(repositoryRoot);
  const workflowRoot = path.join(workflowSourceRoot, 'apps/mobile/src/agent/visitQuestions');
  const { runVisitQuestionWorkflow } = require(path.join(workflowRoot, 'workflow'));
  const context = await makePreparedContext(testCase, testOverrides.fixture);
  // Injected environment and fetch keep provider-boundary integration tests local while exercising the real graph.
  const providerConfig = getVisitQuestionProviderConfig(testOverrides.environment ?? process.env);
  let selectedProvider;
  if (providerConfig.mode === 'test-adapter') {
    const scripted = createScriptedProvider(testCase);
    selectedProvider = {
      provider: scripted.provider,
      providerTurns: scripted.providerTurns,
      // Keep this getter live; spreading the adapter would snapshot its zero count before execution.
      get callCount() {
        return scripted.callCount;
      },
      getTokenUsage: () => null,
      providerInputs: scripted.providerInputs,
    };
  } else {
    selectedProvider = createOpenAIChatCompletionsProvider({
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
      ...(testOverrides.fetchImpl ? { fetchImpl: testOverrides.fetchImpl } : {}),
    });
  }
  const selection = {
    providerId: selectedProvider.provider.id,
    modelId: providerConfig.model,
  };
  testOverrides.onContext?.({
    evaluationCase: context.evaluationCase,
    appointmentContext: context.prepared.appointmentContext,
    providerInputs: selectedProvider.providerInputs ?? [],
    trace: context.trace,
  });
  const startedAt = process.hrtime.bigint();
  try {
    const result = await runVisitQuestionWorkflow({
      prepared: context.prepared,
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
      const expectedCalls = testCase.expected.resultMode === 'suggestions' ? 3 : 2;
      if (selectedProvider.callCount !== expectedCalls) {
        // Preserve the graph status beside protocol traces so a test-adapter error is diagnosable.
        throw new Error(
          `The scripted test adapter expected ${expectedCalls} calls but received ${selectedProvider.callCount}; status=${result.status}; turns=${selectedProvider.providerTurns.join(',')}.`,
        );
      }
    }

    return toLangSmithOutput(result, {
      providerMode: providerConfig.mode,
      latencyMs,
      tokenUsage: selectedProvider.getTokenUsage(),
    });
  } finally {
    await context.close();
  }
}

module.exports = { FIXTURE_SEED, runSyntheticCase };
