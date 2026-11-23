import { proposeConversationTemplate } from '../conversationTemplateProposal';
import {
  choice,
  fixture,
} from '../testSupport/conversationTemplateProposalFixture';

test('unknown mode, unavailable and unsupported provider choices produce no proposal', async () => {
  const f = fixture(choice({ intent: 'health-summary' }));
  const ready = await f.input.select();
  if (ready.status !== 'ready') throw new Error('No fixture selection');
  for (const selection of [
    { status: 'selection-required' } as const,
    { status: 'unavailable' } as const,
    { ...ready, remoteProcessing: false },
    {
      ...ready,
      provider: {
        ...ready.provider,
        capabilities: { ...ready.provider.capabilities, toolCalling: false },
      },
    },
  ]) {
    f.input.select.mockResolvedValueOnce(selection);
    await expect(proposeConversationTemplate(f.input)).resolves.toEqual({
      intent: undefined,
      spent: false,
    });
  }
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.authorization).not.toHaveBeenCalled();
});
