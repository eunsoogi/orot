import { visitQuestionResponseShape } from '../e2e/visitQuestionResponseShape';
import { reportVisitQuestionValidation } from '../e2e/visitQuestionValidationDiagnostic';

jest.mock('../src/agent/visitQuestions/validationDiagnostics', () => ({
  reportVisitQuestionValidation: jest.fn(),
}));

test('reports fixed response shapes without values, identifiers or unexpected keys', () => {
  const secret = 'synthetic-private-marker';
  const result = visitQuestionResponseShape({
    text: '',
    toolCalls: [],
    finishReason: 'complete',
    structuredOutput: {
      type: 'result',
      citations: [secret],
      value: {
        status: 'suggestions',
        questions: [
          {
            questionText: secret,
            rationale: secret,
            priority: secret,
            evidenceIds: [secret],
            [secret]: secret,
          },
        ],
      },
    },
  });
  expect(result).toMatchObject({
    stage: 'final',
    citations: { type: 'array', count: 1, elementTypes: ['string'] },
    questions: { type: 'array', count: 1 },
    questionFields: [
      { questionText: 'string', evidenceIds: { count: 1 }, extraCount: 1 },
    ],
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(
    visitQuestionResponseShape({
      text: '{',
      toolCalls: [],
      finishReason: 'complete',
    }),
  ).toEqual({ stage: 'unparseable' });
});

test('reports closed local validation reasons and suppresses arbitrary text', () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  reportVisitQuestionValidation({
    status: 'invalid',
    reason: 'A visit question contains an unsupported date or numeric value.',
  });
  reportVisitQuestionValidation({
    status: 'invalid',
    reason: 'synthetic-private-marker',
  });
  expect(log.mock.calls).toEqual([
    ['OROT_SYNTHETIC_VALIDATION unsupported_fact'],
    ['OROT_SYNTHETIC_VALIDATION other'],
  ]);
  log.mockRestore();
});

test('redirects only the visit task validation observer', () => {
  const config = require('../e2e/visit-question-scope.metro.config');
  const result = config.resolver.resolveRequest(
    { originModulePath: '/app/src/agent/visitQuestions/taskContract.ts' },
    './validationDiagnostics',
    'ios',
  );
  expect(result.filePath).toMatch(/visitQuestionValidationDiagnostic\.ts$/u);
});
