import { expect, test } from '@jest/globals';
const {
  decisionCases,
} = require('../../../scripts/evaluation/visit-questions/decision-corpus.cjs');
const {
  makeDecisionContext,
} = require('../../../scripts/evaluation/visit-questions/decision-context.cjs');
const {
  runSyntheticCase,
} = require('../../../scripts/evaluation/visit-questions/workflow-harness.cjs');
const {
  evaluateVisitQuestionCase,
} = require('../../../scripts/evaluation/visit-questions/evaluators');

const {
  HUMAN_REVIEW,
} = require('../../../scripts/evaluation/visit-questions/decision-usefulness.cjs');
const {
  getEvaluationRevisionMetadata,
} = require('../../../scripts/evaluation/visit-questions/revision.cjs');
const {
  getWorkflowSourceRoot,
} = require('../../../scripts/evaluation/visit-questions/source-root.cjs');
const {
  getVisitQuestionProviderConfig,
} = require('../../../scripts/evaluation/visit-questions/provider-config.cjs');
const root = require('node:path').resolve(__dirname, '../../..');
const manual =
  process.env.OROT_RUN_VISIT_QUESTION_EVAL === '1' &&
  process.env.OROT_VISIT_QUESTION_CORPUS === 'decisions';

test.each(decisionCases())(
  'runs decision corpus through the actual workflow: $caseId',
  async (testCase) => {
    const output = await runSyntheticCase(testCase, {
      // Ordinary tests never inherit API credentials or remote-provider selection.
      environment: manual ? process.env : {},
      prepareContext: makeDecisionContext,
    });
    const scores = evaluateVisitQuestionCase(testCase, output);
    if (manual) {
      process.stdout.write(
        JSON.stringify({
          caseId: testCase.caseId,
          ...getEvaluationRevisionMetadata(root, getWorkflowSourceRoot(root)),
          providerMode: output.execution.providerMode,
          model: getVisitQuestionProviderConfig(process.env).model,
          boundary: 'curated-synthetic-snapshot; not a retrieval benchmark',
          scores,
          output,
          semanticReview: 'pending',
          reviewerQuestions: HUMAN_REVIEW,
          note: 'Lexical proxy success is not a semantic or clinical quality pass.',
        }) + '\n',
      );
    }
    if (output.execution.providerMode === 'test-adapter') {
      expect(output.execution.tokenUsage.status).toBe('unmeasured');
      expect(output.status).toBe(
        testCase.expected.resultMode === 'suggestions' ? 'ready' : 'needs_clarification',
      );
      expect(scores.source_support).toBe(1);
      expect(scores.useful_questions).toBe(1);
      expect(scores.unsafe_medication_change).toBe(1);
    } else {
      // Keep real-model failures in the report instead of converting them to authored successes.
      expect(Object.values(scores).every((value) => typeof value === 'number')).toBe(true);
    }
  },
  45000,
);
