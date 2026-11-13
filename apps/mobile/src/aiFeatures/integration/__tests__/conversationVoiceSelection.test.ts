import { voiceSelectionMatches } from '../conversationVoiceSelection';
import type { requireSelectedAi } from '../provider';

test('voice consent is invalid if the actual provider or model changes', () => {
  const selected = {
    provider: { id: 'provider' },
    modelId: 'model',
  } as ReturnType<typeof requireSelectedAi>;
  expect(
    voiceSelectionMatches(
      { expectedVoiceSelection: { providerId: 'provider', modelId: 'model' } },
      selected,
    ),
  ).toBe(true);
  expect(
    voiceSelectionMatches(
      { expectedVoiceSelection: { providerId: 'other', modelId: 'model' } },
      selected,
    ),
  ).toBe(false);
  expect(
    voiceSelectionMatches(
      { expectedVoiceSelection: { providerId: 'provider', modelId: 'other' } },
      selected,
    ),
  ).toBe(false);
  expect(voiceSelectionMatches(undefined, selected)).toBe(true);
});
