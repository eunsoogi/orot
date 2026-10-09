import { diseaseHypothesisTask, runDiseaseHypothesisAnalysis } from '../task';
import * as deletionAwareRevalidation from '../../memory/deletionAwareEvidenceRevalidation';
import {
  completeInventory,
  evidence,
  hypothesis,
  reference,
  workflowOptions,
} from '../taskTestSupport';

beforeEach(() => {
  jest
    .spyOn(deletionAwareRevalidation, 'withLocalDeletionAwareRevalidation')
    .mockImplementation(revalidate => revalidate);
});

afterEach(() => jest.restoreAllMocks());

test('accepts grounded hypotheses with an exact current supporting reference', () => {
  const result = diseaseHypothesisTask.validateResult(
    { hypotheses: [hypothesis()] },
    { request: '가능성을 살펴봐 주세요', evidence },
  );

  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.hypotheses[0]?.supportingEvidence).toEqual([reference]);
    expect(
      result.value.hypotheses[0]?.supportingEvidence[0],
    ).not.toHaveProperty('content');
  }
});

test('rejects unsupported or uncited hypotheses and requires missing-data disclosure', () => {
  const context = { request: '가능성을 살펴봐 주세요', evidence };
  expect(
    diseaseHypothesisTask.validateResult(
      { hypotheses: [hypothesis({ supportingEvidence: [] })] },
      context,
    ).status,
  ).toBe('invalid');
  expect(
    diseaseHypothesisTask.validateResult(
      {
        hypotheses: [
          hypothesis({
            supportingEvidence: [{ ...reference, evidenceRevision: 'old' }],
          }),
        ],
      },
      context,
    ).status,
  ).toBe('invalid');
  expect(
    diseaseHypothesisTask.validateResult(
      { hypotheses: [hypothesis({ missingData: 'not-an-array' })] },
      context,
    ).status,
  ).toBe('invalid');
});

test('rejects a definitive diagnosis claim while preserving tentative hypotheses', () => {
  const result = diseaseHypothesisTask.validateResult(
    {
      hypotheses: [
        hypothesis({
          title: 'Confirmed diabetes',
          summary: 'You definitely have diabetes.',
          uncertainty: 'There is no uncertainty.',
        }),
      ],
    },
    { request: '가능성을 살펴봐 주세요', evidence },
  );

  expect(result.status).toBe('invalid');
  expect(
    diseaseHypothesisTask.validateResult(
      { hypotheses: [hypothesis()] },
      { request: '가능성을 살펴봐 주세요', evidence },
    ).status,
  ).toBe('valid');
});

test('makes the non-diagnosis and no-medication-change boundary explicit', () => {
  expect(diseaseHypothesisTask.systemPrompt).toMatch(/not a diagnosis/i);
  expect(diseaseHypothesisTask.systemPrompt).toMatch(
    /Never recommend starting, stopping, or changing medication/,
  );
});

test('does not start the model workflow when the full local record inventory is unavailable', async () => {
  const outcome = await runDiseaseHypothesisAnalysis({} as never, {
    inventoryComplete: false,
    availableKinds: [],
    queriedKinds: [],
    unsupportedKinds: [],
    truncatedKinds: [],
  });
  expect(outcome).toEqual({
    status: 'incomplete_inventory',
    reason: 'unavailable',
  });
});

test('returns a current cited hypothesis through the public workflow wrapper', async () => {
  const outcome = await runDiseaseHypothesisAnalysis(
    workflowOptions(),
    completeInventory(),
  );

  expect(outcome.status).toBe('workflow');
  if (outcome.status !== 'workflow')
    throw new Error('Expected a workflow result.');
  expect(outcome.result.status).toBe('result');
  if (outcome.result.status !== 'result') return;
  expect(outcome.result.citations).toEqual([reference]);
  expect(outcome.result.value.hypotheses[0]?.supportingEvidence).toEqual([
    reference,
  ]);
  expect(
    deletionAwareRevalidation.withLocalDeletionAwareRevalidation,
  ).toHaveBeenCalled();
  expect(
    outcome.result.value.hypotheses[0]?.supportingEvidence[0],
  ).not.toHaveProperty('content');
});
