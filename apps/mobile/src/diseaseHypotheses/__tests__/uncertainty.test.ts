import { runDiseaseHypothesisAnalysis } from '../task';
import * as deletionAwareRevalidation from '../../memory/deletionAwareEvidenceRevalidation';
import {
  completeInventory,
  hypothesis,
  workflowOptionsFor,
} from '../taskTestSupport';

beforeEach(() => {
  jest
    .spyOn(deletionAwareRevalidation, 'withLocalDeletionAwareRevalidation')
    .mockImplementation(revalidate => revalidate);
});

afterEach(() => jest.restoreAllMocks());

test.each([
  ['limited information', 'Limited information'],
  ['the Korean disclaimer', '현재 자료만으로는 확진할 수 없어요.'],
  [
    'the English disclaimer',
    'No definitive diagnosis can be made from these records.',
  ],
])(
  'accepts %s as uncertainty through the workflow',
  async (_label, uncertainty) => {
    const outcome = await runDiseaseHypothesisAnalysis(
      workflowOptionsFor({ hypotheses: [hypothesis({ uncertainty })] }),
      completeInventory(),
    );

    expect(outcome.status).toBe('workflow');
    if (outcome.status !== 'workflow')
      throw new Error('Expected a workflow result.');
    expect(outcome.result.status).toBe('result');
  },
);

test('blocks the exact definitive-diagnosis response through the workflow', async () => {
  const outcome = await runDiseaseHypothesisAnalysis(
    workflowOptionsFor({
      hypotheses: [
        hypothesis({
          title: 'Confirmed diabetes',
          summary: 'You definitely have diabetes.',
          uncertainty: 'There is no uncertainty.',
        }),
      ],
    }),
    completeInventory(),
  );

  expect(outcome.status).toBe('workflow');
  if (outcome.status !== 'workflow')
    throw new Error('Expected a workflow result.');
  expect(outcome.result.status).toBe('invalid_output');
});

test('does not let a disclaimer hide a separate definitive claim', async () => {
  const outcome = await runDiseaseHypothesisAnalysis(
    workflowOptionsFor({
      hypotheses: [
        hypothesis({
          uncertainty:
            'No definitive diagnosis can be made from these records, but you definitely have diabetes.',
        }),
      ],
    }),
    completeInventory(),
  );

  expect(outcome.status).toBe('workflow');
  if (outcome.status !== 'workflow')
    throw new Error('Expected a workflow result.');
  expect(outcome.result.status).toBe('invalid_output');
});
