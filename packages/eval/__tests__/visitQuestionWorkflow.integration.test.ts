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
      description: `Actual #30 workflow with the ${providerMode} evaluation provider.`,
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
  it('runs the actual #30 graph and optionally uploads allowlisted results', async () => {
    disableAmbientTracing(process.env);
    const providerConfig = getVisitQuestionProviderConfig(process.env);
    const fixture = createSyntheticVisitQuestionFixture(FIXTURE_SEED);
    const workflowSourceRoot = getWorkflowSourceRoot(repoRoot);
    const revisions = getEvaluationRevisionMetadata(repoRoot, workflowSourceRoot);
    const examples = fixture.cases.map(toLangSmithExample);
    const outputs = new Map<string, any>();
    const report = [];

    for (const testCase of fixture.cases) {
      const output = await runSyntheticCase(testCase);
      const expectedStatus =
        testCase.expected.resultMode === 'suggestions' ? 'ready' : 'needs_clarification';
      outputs.set(testCase.caseId, output);
      const example = examples.find((item) => item.inputs.caseId === testCase.caseId)!;
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
      ? await uploadSyntheticResults(fixture.cases, outputs, revisions, providerConfig.mode)
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
    expect(report).toHaveLength(fixture.cases.length);
    if (providerConfig.mode === 'test-adapter') {
      expect(report.every((item) => item.execution.tokenUsage.status === 'unmeasured')).toBe(true);
    }
  });
});
