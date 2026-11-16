import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';
import { t } from '../../../i18n';

// A synthetic oversized request exercises the real runtime-to-visit mapping without provider use.
test('reports local payload exhaustion as a bounded request failure rather than provider configuration', async () => {
  const { provider, requests } = makeProvider([]);
  const { selection, option } = selectedOption(provider);
  const confirmConsent = jest.fn(async () => true);
  const result = await runVisitQuestionWorkflow({
    prepared: preparedContext(),
    request: '합성'.repeat(12_000),
    selection,
    providerOptions: [option],
    recipient: 'Synthetic selected account',
    confirmConsent,
  });
  expect(result).toMatchObject({
    status: 'budget_exceeded',
    message: t('visitQuestions.workflowResults.failure.budgetExceeded'),
  });
  expect(result).not.toHaveProperty('providerErrorCode');
  expect(JSON.stringify(result)).not.toContain(
    t('ragConversation.failureProviderConfiguration'),
  );
  expect(requests).toEqual([]);
  expect(confirmConsent).not.toHaveBeenCalled();
});
