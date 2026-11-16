import { conversationReceiptSelection } from '../conversationReceiptSelection';
import type { SelectedAiResolution } from '../provider';

/** Reuse the boundary shared by ordinary, summary, visit and daily-report provider paths. */
test('a model switch after session resolution fails before inference or receipt publication', () => {
  const generate = jest.fn();
  const onProviderReceipt = jest.fn();
  const selected = {
    status: 'ready',
    provider: { id: 'provider', generate },
    modelId: 'new',
    option: { provider: { id: 'provider', generate } },
  } as unknown as SelectedAiResolution;
  expect(() =>
    conversationReceiptSelection(selected, {
      expectedConversationModel: { providerId: 'provider', modelId: 'old' },
      onProviderReceipt,
    }),
  ).toThrow('model changed');
  expect(generate).not.toHaveBeenCalled();
  expect(onProviderReceipt).not.toHaveBeenCalled();
});
test('same model selection without a receipt observer preserves the original selection', () => {
  const selected = {
    status: 'ready',
    provider: { id: 'provider' },
    modelId: 'same',
  } as unknown as SelectedAiResolution;
  expect(
    conversationReceiptSelection(selected, {
      expectedConversationModel: { providerId: 'provider', modelId: 'same' },
    }),
  ).toBe(selected);
});
