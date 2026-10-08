import { describe, expect, it, jest } from '@jest/globals';

const manualWorkflowTest = '<rootDir>/__tests__/visitQuestionWorkflow.integration.test.ts';

// Isolated imports let this test inspect both discovery modes without replacing Jest's active config.
function loadEvaluationJestConfig(): { testPathIgnorePatterns: string[] } {
  let config: { testPathIgnorePatterns: string[] } | undefined;
  jest.isolateModules(() => {
    config = require('../jest.config.js');
  });
  return config!;
}

describe('evaluation Jest discovery', () => {
  it('excludes the opt-in workflow suite from unit runs and includes it for the runner', () => {
    const originalMode = process.env.OROT_RUN_VISIT_QUESTION_EVAL;

    try {
      delete process.env.OROT_RUN_VISIT_QUESTION_EVAL;
      expect(loadEvaluationJestConfig().testPathIgnorePatterns).toContain(manualWorkflowTest);

      process.env.OROT_RUN_VISIT_QUESTION_EVAL = '1';
      expect(loadEvaluationJestConfig().testPathIgnorePatterns).not.toContain(manualWorkflowTest);
    } finally {
      if (originalMode === undefined) {
        delete process.env.OROT_RUN_VISIT_QUESTION_EVAL;
      } else {
        process.env.OROT_RUN_VISIT_QUESTION_EVAL = originalMode;
      }
    }
  });
});
