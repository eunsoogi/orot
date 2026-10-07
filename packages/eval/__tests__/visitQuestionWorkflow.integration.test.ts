import { describe, expect, it } from '@jest/globals';
import path from 'node:path';
import { createSyntheticVisitQuestionFixture } from '../src';

const {
  disableAmbientTracing,
  isLangSmithUploadEnabled,
  toLangSmithExample,
} = require('../../../scripts/evaluation/visit-questions/privacy');
const {
  evaluateVisitQuestionWithLangSmith,
} = require('../../../scripts/evaluation/visit-questions/evaluators');
const {
  FIXTURE_SEED,
  runSyntheticCase,
} = require('../../../scripts/evaluation/visit-questions/workflow-harness.cjs');
const {
  getEvaluationRevisionMetadata,
  toLangSmithRevisionMetadata,
} = require('../../../scripts/evaluation/visit-questions/revision.cjs');
const repoRoot = path.resolve(__dirname, '../../..');
const evaluationSuite = process.env.OROT_RUN_VISIT_QUESTION_EVAL === '1' ? describe : describe.skip;

/** Uploads only allowlisted outputs previously produced by the local app graph. */
async function uploadSyntheticResults(examples: any[], outputs: Map<string, any>, revisions: any) {
  const { createRequire } = require('node:module');
  const runtimeRequire = createRequire(path.join(repoRoot, 'packages/agent-runtime/package.json'));
  const coreRequire = createRequire(runtimeRequire.resolve('@langchain/core'));
  const { evaluate } = coreRequire('langsmith/evaluation');
  const experiment = await evaluate(
    async (inputs: any) => {
      const output = outputs.get(inputs.caseId);
      if (!output) throw new Error('Synthetic evaluation output is missing.');
      return output;
    },
    {
      data: examples,
      evaluators: [evaluateVisitQuestionWithLangSmith],
      experimentPrefix: 'orot-visit-questions-synthetic',
      description: 'Actual #30 workflow with a deterministic test-only provider.',
      metadata: {
        providerMode: 'test-adapter',
        fixtureSeed: FIXTURE_SEED,
        tokenUsage: 'unmeasured',
        ...toLangSmithRevisionMetadata(revisions),
      },
      maxConcurrency: 1,
    },
  );
  let completed = 0;
  for await (const row of experiment) {
    if (!row.run) throw new Error('LangSmith returned an incomplete run.');
    completed += 1;
  }
  if (completed !== examples.length) {
    throw new Error('LangSmith did not finish every synthetic example.');
  }
}

evaluationSuite('manual synthetic visit-question graph evaluation', () => {
  it('runs the actual #30 graph and optionally uploads allowlisted results', async () => {
    disableAmbientTracing(process.env);
    const fixture = createSyntheticVisitQuestionFixture(FIXTURE_SEED);
    const revisions = getEvaluationRevisionMetadata(repoRoot);
    const examples = fixture.cases.map(toLangSmithExample);
    const outputs = new Map<string, any>();
    const report = [];

    for (const testCase of fixture.cases) {
      const output = await runSyntheticCase(testCase);
      const expectedStatus =
        testCase.expected.resultMode === 'suggestions' ? 'ready' : 'needs_clarification';
      expect(output.status).toBe(expectedStatus);
      outputs.set(testCase.caseId, output);
      const example = examples.find((item) => item.inputs.caseId === testCase.caseId)!;
      const scores = evaluateVisitQuestionWithLangSmith({
        inputs: example.inputs,
        outputs: output,
        referenceOutputs: example.outputs,
      });
      const scoreMap = Object.fromEntries(scores.map((item) => [item.key, item.score]));
      for (const key of [
        'source_support',
        'temporal_correctness',
        'numeric_correctness',
        'useful_questions',
        'clarification_behavior',
        'unsafe_medication_change',
      ]) {
        expect(scoreMap[key]).toBe(1);
      }
      report.push({
        caseId: testCase.caseId,
        status: output.status,
        scores: scoreMap,
        execution: output.execution,
      });
    }

    const uploaded = isLangSmithUploadEnabled(process.env);
    if (uploaded) await uploadSyntheticResults(examples, outputs, revisions);
    process.stdout.write(
      `${JSON.stringify(
        {
          fixtureSeed: FIXTURE_SEED,
          providerMode: 'test-adapter',
          uploadedToLangSmith: uploaded,
          ...revisions,
          cases: report,
        },
        null,
        2,
      )}\n`,
    );
    expect(report).toHaveLength(fixture.cases.length);
    expect(report.every((item) => item.execution.tokenUsage.status === 'unmeasured')).toBe(true);
  });
});
