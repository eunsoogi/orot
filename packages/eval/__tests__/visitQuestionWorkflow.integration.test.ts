import { describe, expect, it } from '@jest/globals';
import path from 'node:path';
import { createSyntheticVisitQuestionFixture } from '../src';

const {
  disableAmbientTracing,
  getLangSmithApiKey,
  isLangSmithUploadEnabled,
  toLangSmithExample,
} = require('../../../scripts/evaluation/visit-questions/privacy');
const {
  getVisitQuestionProviderConfig,
} = require('../../../scripts/evaluation/visit-questions/provider-config.cjs');
const {
  evaluateVisitQuestionWithLangSmith,
} = require('../../../scripts/evaluation/visit-questions/evaluators');
const {
  FIXTURE_SEED,
  runSyntheticCase,
} = require('../../../scripts/evaluation/visit-questions/workflow-harness.cjs');
const {
  createScriptedProvider,
} = require('../../../scripts/evaluation/visit-questions/scripted-provider.cjs');
const {
  createOpenAITestFetch,
} = require('../../../scripts/evaluation/visit-questions/openai-test-adapter.cjs');
const {
  ensureSyntheticDataset,
} = require('../../../scripts/evaluation/visit-questions/langsmith-dataset.cjs');
const {
  assertLangSmithEvaluationComplete,
} = require('../../../scripts/evaluation/visit-questions/langsmith-evaluation.cjs');
const {
  getEvaluationRevisionMetadata,
  toLangSmithRevisionMetadata,
} = require('../../../scripts/evaluation/visit-questions/revision.cjs');
const {
  getWorkflowSourceRoot,
} = require('../../../scripts/evaluation/visit-questions/source-root.cjs');
const repoRoot = path.resolve(__dirname, '../../..');
const RUBRIC_DIMENSIONS = [
  'source_support',
  'temporal_correctness',
  'numeric_correctness',
  'useful_questions',
  'clarification_behavior',
  'unsafe_medication_change',
];

/** Uploads only allowlisted outputs previously produced by the local app graph. */
async function uploadSyntheticResults(
  testCases: any[],
  outputs: Map<string, any>,
  revisions: any,
  providerMode: string,
) {
  const { createRequire } = require('node:module');
  const runtimeRequire = createRequire(path.join(repoRoot, 'packages/agent-runtime/package.json'));
  const coreRequire = createRequire(runtimeRequire.resolve('@langchain/core'));
  const { evaluate } = coreRequire('langsmith/evaluation');
  const { Client } = coreRequire('langsmith');
  const client = new Client({ apiKey: getLangSmithApiKey(process.env) });
  const dataset = await ensureSyntheticDataset(client, FIXTURE_SEED, testCases);
  // Mixed provider responses stay distinct from fully measured and fully unmeasured runs.
  const tokenStatuses = [...outputs.values()].map((output) => output.execution.tokenUsage.status);
  const tokenUsageSummary = tokenStatuses.every((status) => status === 'measured')
    ? 'measured'
    : tokenStatuses.every((status) => status === 'unmeasured')
      ? 'unmeasured'
      : 'partial';
  const experiment = await evaluate(
    async (inputs: any) => {
      const output = outputs.get(inputs.caseId);
      if (!output) throw new Error('Synthetic evaluation output is missing.');
      return output;
    },
    {
      // Evaluate the persisted dataset so the SDK receives complete Example objects and timestamps.
      data: dataset.datasetId,
      evaluators: [evaluateVisitQuestionWithLangSmith],
      experimentPrefix: 'orot-visit-questions-synthetic',
      description: `Actual visit-question workflow with the ${providerMode} evaluation provider.`,
      client,
      disableEvaluatorTracing: true,
      metadata: {
        providerMode,
        fixtureSeed: FIXTURE_SEED,
        tokenUsage: tokenUsageSummary,
        ...toLangSmithRevisionMetadata(revisions),
      },
      maxConcurrency: 1,
    },
  );
  assertLangSmithEvaluationComplete(experiment, testCases.length);
  return dataset;
}

// The dedicated runner opts this suite in through Jest config instead of reporting a skipped test.
describe('manual synthetic visit-question graph evaluation', () => {
  it('passes mocked OpenAI response usage through the actual graph result', async () => {
    disableAmbientTracing(process.env);
    const fixture = createSyntheticVisitQuestionFixture(FIXTURE_SEED);
    const testCase = fixture.cases[0];
    const scripted = createScriptedProvider(testCase);
    const calls: Array<{
      url: string;
      authorization: string;
      providerOutcome?: string;
      providerError?: string;
      providerErrorCode?: string;
    }> = [];
    const fetchImpl = createOpenAITestFetch(scripted.provider, calls);
    const environment = {
      OROT_VISIT_QUESTION_PROVIDER: 'openai-api',
      OROT_VISIT_QUESTION_MODEL: 'synthetic-model',
      OROT_ALLOW_SYNTHETIC_REMOTE_PROCESSING: '1',
      OPENAI_API_KEY: 'synthetic-test-key',
    };
    const originalFetch = globalThis.fetch;
    // A lost injection must fail locally instead of sending fixture content to the provider.
    globalThis.fetch = async () => {
      throw new Error('The mocked provider integration must not use the network.');
    };
    let output;
    try {
      output = await runSyntheticCase(testCase, { environment, fetchImpl, fixture });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(output.status).toBe('ready');
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.url === 'https://api.openai.com/v1/chat/completions')).toBe(
      true,
    );
    expect(calls.every((call) => call.authorization === 'Bearer synthetic-test-key')).toBe(true);
    // Fetch attempts are recorded before the scripted provider returns, so verify its outcome too.
    expect(
      calls.map((call) => ({
        outcome: call.providerOutcome,
        error: call.providerError ?? call.providerErrorCode ?? null,
      })),
    ).toEqual([
      { outcome: 'returned', error: null },
      { outcome: 'returned', error: null },
      { outcome: 'returned', error: null },
    ]);
    expect(output.execution).toEqual({
      providerMode: 'openai-api',
      latencyMs: expect.any(Number),
      tokenUsage: { status: 'measured', inputTokens: 33, outputTokens: 21, totalTokens: 54 },
    });
    expect(JSON.stringify(output)).not.toContain('synthetic-test-key');
  });

  it('runs the visit-question workflow and optionally uploads allowlisted results', async () => {
    disableAmbientTracing(process.env);
    const providerConfig = getVisitQuestionProviderConfig(process.env);
    const fixture = createSyntheticVisitQuestionFixture(FIXTURE_SEED);
    const workflowSourceRoot = getWorkflowSourceRoot(repoRoot);
    const revisions = getEvaluationRevisionMetadata(repoRoot, workflowSourceRoot);
    const outputs = new Map<string, any>();
    const evaluatedCases: any[] = [];
    const traces: any[] = [];
    const report = [];

    for (const testCase of fixture.cases) {
      let evaluationCase: any;
      const output = await runSyntheticCase(testCase, {
        fixture,
        onContext: (context: any) => {
          evaluationCase = context.evaluationCase;
          traces.push(context);
        },
      });
      evaluatedCases.push(evaluationCase);
      const expectedStatus =
        testCase.expected.resultMode === 'suggestions' ? 'ready' : 'needs_clarification';
      outputs.set(testCase.caseId, output);
      const example = toLangSmithExample(evaluationCase);
      const scores = evaluateVisitQuestionWithLangSmith({
        inputs: example.inputs,
        outputs: output,
        referenceOutputs: example.outputs,
      });
      const scoreMap = Object.fromEntries(scores.map((item) => [item.key, item.score]));
      const failedDimensions = RUBRIC_DIMENSIONS.filter((key) => scoreMap[key] !== 1);
      report.push({
        caseId: testCase.caseId,
        status: output.status,
        expectedStatus,
        failedDimensions,
        scores: scoreMap,
        execution: output.execution,
      });
    }

    const uploaded = isLangSmithUploadEnabled(process.env);
    const langSmithDataset = uploaded
      ? await uploadSyntheticResults(evaluatedCases, outputs, revisions, providerConfig.mode)
      : null;
    process.stdout.write(
      `${JSON.stringify(
        {
          evaluationStatus: 'completed',
          fixtureSeed: FIXTURE_SEED,
          providerMode: providerConfig.mode,
          uploadedToLangSmith: uploaded,
          langSmithDataset,
          ...revisions,
          cases: report,
        },
        null,
        2,
      )}\n`,
    );
    // Keep rubric failures visible in the reproducible report instead of treating them as run failures.
    expect(report.map((item) => item.caseId)).toEqual(
      fixture.cases.map((testCase) => testCase.caseId),
    );
    expect(
      report.every((item) => {
        const expectedFailures = RUBRIC_DIMENSIONS.filter((key) => item.scores[key] !== 1);
        return (
          RUBRIC_DIMENSIONS.every((key) => typeof item.scores[key] === 'number') &&
          JSON.stringify(item.failedDimensions) === JSON.stringify(expectedFailures)
        );
      }),
    ).toBe(true);
    if (providerConfig.mode === 'test-adapter') {
      // Deterministic outcomes belong to the scripted adapter; live-model scores remain report data.
      expect(report.map(({ status, failedDimensions }) => [status, failedDimensions])).toEqual([
        ['ready', []],
        ['needs_clarification', []],
        ['needs_clarification', ['useful_questions']],
      ]);
      expect(traces.map(({ providerInputs }) => providerInputs[0]?.query)).toEqual(
        fixture.cases.map(({ query }) => query),
      );
      expect(new Set(traces.map(({ providerInputs }) => providerInputs[0]?.query)).size).toBe(3);
      expect(traces[0].trace).toMatchObject({
        ragIndexCalls: 1,
        ragSearchCalls: 1,
        memoryStoreSearches: 1,
      });
      expect(traces[0].trace.memoryQueryServiceSearches).toBeGreaterThan(0);
      expect(report.every((item) => item.execution.tokenUsage.status === 'unmeasured')).toBe(true);
    }
  });
});
