'use strict';

const { makePreparedContext } = require('./synthetic-evidence.cjs');
const { createScriptedProvider } = require('./scripted-provider.cjs');
const { createOpenAIChatCompletionsProvider } = require('./openai-api-provider.cjs');
const { getVisitQuestionProviderConfig } = require('./provider-config.cjs');
const { toLangSmithOutput, toLangSmithExample, disableAmbientTracing } = require('./privacy');
const { runBaseline } = require('./comparison-baselines.cjs');
const { buildComparisonCorpus } = require('./comparison-corpus.cjs');
const { comparisonMetrics, regressionsFor } = require('./comparison-metrics.cjs');
const {
  runVisitQuestionWorkflow,
} = require('../../../apps/mobile/src/agent/visitQuestions/workflow');

const PATHS = ['full-context', 'simple-rag', 'langgraph'];
const RETRIEVAL_LIMIT = 8;

async function runGraph(testCase, prepared, config, fetchImpl) {
  const selected =
    config.mode === 'test-adapter'
      ? { ...createScriptedProvider(testCase), getTokenUsage: () => null }
      : createOpenAIChatCompletionsProvider({
          apiKey: config.apiKey,
          model: config.model,
          ...(fetchImpl ? { fetchImpl } : {}),
        });
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection: { providerId: selected.provider.id, modelId: config.model },
    providerOptions: [
      {
        provider: selected.provider,
        modelId: config.model,
        displayName: selected.provider.displayName,
        privacyBoundary: config.allowRemoteProcessing ? 'selected-context-remote' : 'on-device',
        availability: { status: 'available' },
      },
    ],
    ...(config.allowRemoteProcessing
      ? { recipient: 'Synthetic evaluation account', confirmConsent: async () => true }
      : {}),
  });
  return toLangSmithOutput(result, {
    providerMode: config.mode,
    tokenUsage: selected.getTokenUsage(),
  });
}

/** Fresh contexts isolate stores per path; only the retrieval strategy and orchestration differ. */
async function compareSyntheticCase(testCase, fixture, options = {}) {
  disableAmbientTracing(process.env);
  const config = getVisitQuestionProviderConfig(options.environment ?? process.env);
  const rows = [];
  const canonical = await makePreparedContext(fixture.cases[0], fixture);
  let corpus;
  try {
    corpus = await buildComparisonCorpus(fixture, canonical);
  } finally {
    await canonical.close();
  }
  for (const path of PATHS) {
    const context = await makePreparedContext(testCase, fixture);
    const delivered = new Set();
    const search = context.prepared.searchEvidence;
    context.prepared.searchEvidence = async (...args) => {
      const found = await search(...args);
      found.batch.items.forEach(({ evidenceId }) => delivered.add(evidenceId));
      return found;
    };
    const startedAt = process.hrtime.bigint();
    let output;
    let executionStatus = 'completed';
    try {
      if (path === 'langgraph') {
        output = await runGraph(testCase, context.prepared, config, options.fetchImpl);
      } else {
        let items = corpus;
        if (path === 'simple-rag') {
          // One fixed query per source, no model-directed follow-up or graph loop.
          const collections = [];
          for (const kind of ['personal_record', 'reviewed_memory']) {
            collections.push(
              await context.prepared.searchEvidence(
                testCase.query,
                RETRIEVAL_LIMIT,
                kind,
                undefined,
                { store: context.prepared.store },
              ),
            );
          }
          items = [
            ...new Map(
              collections
                .flatMap(({ batch }) => batch.items)
                .map((item) => [item.evidenceId, item]),
            ).values(),
          ];
        }
        items.forEach(({ evidenceId }) => delivered.add(evidenceId));
        output = await runBaseline({
          testCase,
          prepared: context.prepared,
          items,
          config,
          fetchImpl: options.fetchImpl,
        });
      }
      if (!['ready', 'needs_clarification'].includes(output.status)) executionStatus = 'failed';
    } catch {
      // Third-party error text may contain credentials or payloads; retain a safe failure status.
      executionStatus = 'failed';
      output = toLangSmithOutput({ status: 'execution_failed' }, { providerMode: config.mode });
    } finally {
      await context.close();
    }
    output.execution.latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    // Score the same provenance projection as the output allowlist, including locator fields.
    const projected = toLangSmithExample({ ...context.evaluationCase, evidence: corpus });
    const evaluationCase = { ...projected.inputs, expected: projected.outputs };
    rows.push({
      path,
      executionStatus,
      output,
      deliveredEvidenceIds: [...delivered],
      metrics: comparisonMetrics(evaluationCase, output, [...delivered]),
    });
  }
  return { caseId: testCase.caseId, paths: rows, regressions: regressionsFor(rows) };
}

module.exports = { PATHS, RETRIEVAL_LIMIT, compareSyntheticCase };
