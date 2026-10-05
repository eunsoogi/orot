import {
  createAppleSelectionOption,
  createChatGPTSelectionOptions,
  visitRecommendationRequirements,
} from '../options';
import { providerSelectionText } from '../text';

describe('provider selection options', () => {
  it('exposes Apple availability without enabling an unsupported device', () => {
    const option = createAppleSelectionOption('unsupportedDevice');

    expect(option.provider.id).toBe('apple-foundation-models');
    expect(option.modelId).toBe('apple-foundation-models-system-default');
    expect(option.availability).toEqual({
      status: 'unavailable',
      message: providerSelectionText.appleUnsupportedDevice,
    });
    expect(option.privacyBoundary).toBe('on-device');
  });

  it('registers visible ChatGPT models through the normalized provider contract', () => {
    const [option] = createChatGPTSelectionOptions('opaque-synthetic-account', [
      { slug: 'gpt-synthetic', displayName: 'Synthetic model' },
    ]);

    expect(option).toMatchObject({
      modelId: 'gpt-synthetic',
      displayName: 'Synthetic model',
      privacyBoundary: 'selected-context-remote',
      availability: { status: 'available' },
    });
    expect(option?.provider).toMatchObject({
      kind: 'language-model',
      id: 'chatgpt-plan:opaque-synthetic-account:gpt-synthetic',
      capabilities: {
        inputTypes: ['text'],
        streaming: true,
        structuredOutput: false,
        toolCalling: true,
      },
    });
    expect(visitRecommendationRequirements).toEqual({
      inputTypes: ['text'],
      toolCalling: true,
    });
  });

  it('rejects ChatGPT options without an already-discovered opaque account reference', () => {
    expect(() =>
      createChatGPTSelectionOptions('', [
        { slug: 'gpt-synthetic', displayName: 'Synthetic model' },
      ]),
    ).toThrow(providerSelectionText.chatGPTAccountRequired);
  });
});
