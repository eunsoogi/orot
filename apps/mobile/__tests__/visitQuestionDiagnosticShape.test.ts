import {
  observeVisitQuestionResponse,
  visitQuestionResponseShape,
} from '../e2e/visitQuestionResponseShape';
import { createVisitQuestionTaskResponder } from '../e2e/visitQuestionValidationDiagnostic';
import { beginScopeObservation } from '../e2e/visitQuestionScopeGuard';

jest.mock('../src/agent/visitQuestions/taskContract', () => ({
  createVisitQuestionTaskResponder: () => ({
    validateResult: (value: unknown) => value,
  }),
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
  beginScopeObservation(jest.fn());
  const task = createVisitQuestionTaskResponder();
  const invalid = {
    status: 'invalid',
    reason: 'A visit question contains an unsupported date or numeric value.',
  } as const;
  expect(task.validateResult(invalid as never, {} as never)).toBe(invalid);
  task.validateResult(
    {
      status: 'invalid',
      reason: 'synthetic-private-marker',
    } as never,
    {} as never,
  );
  expect(log.mock.calls).toEqual([
    ['OROT_SYNTHETIC_VALIDATION unsupported_fact'],
    ['OROT_SYNTHETIC_VALIDATION other'],
  ]);
  beginScopeObservation(jest.fn());
  expect(task.validateResult(invalid as never, {} as never)).toBe(invalid);
  expect(log).toHaveBeenCalledTimes(2);
  log.mockRestore();
});

test('suppresses stale response logs without changing the returned response', () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const token = beginScopeObservation(jest.fn());
  const response = {
    text: '{}',
    toolCalls: [],
    finishReason: 'complete',
  } as const;
  expect(observeVisitQuestionResponse(token, 1, response)).toBe(response);
  beginScopeObservation(jest.fn());
  expect(observeVisitQuestionResponse(token, 1, response)).toBe(response);
  expect(log).toHaveBeenCalledTimes(1);
  log.mockRestore();
});

test('redirects only the visit task validation observer', () => {
  const config = require('../e2e/visit-question-scope.metro.config');
  const result = config.resolver.resolveRequest(
    { originModulePath: '/app/src/agent/visitQuestions/workflow.ts' },
    './taskContract',
    'ios',
  );
  expect(result.filePath).toMatch(/visitQuestionValidationDiagnostic\.ts$/u);
});
