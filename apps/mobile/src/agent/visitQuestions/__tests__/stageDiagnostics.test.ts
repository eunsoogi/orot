import { providerDiagnostic } from '../../../providers/diagnostics';
import { runVisitQuestionWorkflow } from '../workflow';
import { suggestionOutput } from '../testing/responseCorrectionFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../testing/workflowFixtures';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
  reportWorkflowOutcome: jest.fn(),
  reportProviderException: jest.fn(),
}));

test('separates consent, source revalidation and provider waits with content-free tokens', async () => {
  const { provider } = makeProvider([
    suggestionOutput('다음 진료 전에 어떤 변화를 기록하면 좋을까요?'),
  ]);
  const { selection, option } = selectedOption(provider);
  const result = await runVisitQuestionWorkflow({
    prepared: preparedContext(),
    selection,
    providerOptions: [option],
    recipient: 'Synthetic recipient',
    confirmConsent: async () => true,
  });
  expect(result.status).toBe('ready');
  const calls = jest
    .mocked(providerDiagnostic)
    .mock.calls.filter(([, stage]) =>
      ['consent_wait', 'provider_wait', 'evidence_check'].includes(stage),
    );
  expect(calls).toEqual([
    ['visit', 'consent_wait', 'started'],
    ['visit', 'consent_wait', 'completed'],
    ['visit', 'evidence_check', 'started'],
    ['visit', 'evidence_check', 'completed'],
    ['visit', 'provider_wait', 'started'],
    ['visit', 'provider_wait', 'completed'],
    // Final graph completion also rechecks current evidence before yielding the task result.
    ['visit', 'evidence_check', 'started'],
    ['visit', 'evidence_check', 'completed'],
    ['visit', 'evidence_check', 'started'],
    ['visit', 'evidence_check', 'completed'],
  ]);
});
