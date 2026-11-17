import { ragConversationTask } from '../task';
import {
  answer,
  input,
} from '../testSupport/structuredPossibilityReportFixture';

test('preserves the full structured report beyond the former aggregate answer allowance', () => {
  const observations = 'Synthetic reported observation. '.repeat(400);
  const result = ragConversationTask.validateResult(
    { answerKind: 'grounded', answer: { ...answer, observations } },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid')
    throw new Error('Expected complete structured report');
  expect(result.value.answer).toContain(observations);
});
