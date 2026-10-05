import type {
  LanguageModelProvider,
  LanguageModelResponse,
} from '@orot/model-runtime';
import { providerSuccess } from '@orot/model-runtime';
import {
  filterSelectableProviders,
  resolveProviderSelection,
} from '../providerSelection';
import type {
  ProviderSelectionOption,
  ProviderSelectionRequirements,
} from '../types';

const requirements: ProviderSelectionRequirements = {
  inputTypes: ['text'],
  toolCalling: true,
};

function provider(
  id: string,
  capabilities: LanguageModelProvider['capabilities'],
): LanguageModelProvider {
  const response: LanguageModelResponse = {
    text: '질문',
    toolCalls: [],
    finishReason: 'complete',
  };
  return {
    kind: 'language-model',
    id,
    displayName: id,
    capabilities,
    generate: async () => providerSuccess(response),
  };
}

function option(
  id: string,
  capabilities: LanguageModelProvider['capabilities'],
  availability: ProviderSelectionOption['availability'] = {
    status: 'available',
  },
): ProviderSelectionOption {
  return {
    provider: provider(id, capabilities),
    modelId: id === 'apple-foundation-models' ? 'system-default' : 'model-a',
    displayName: id,
    privacyBoundary:
      id === 'apple-foundation-models'
        ? 'on-device'
        : 'selected-context-remote',
    availability,
  };
}

describe('provider selection eligibility', () => {
  it('keeps only available providers with every required workflow capability', () => {
    const apple = option('apple-foundation-models', {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
    });
    const chatGPT = option('chatgpt-plan:account:model-a', {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: true,
    });
    const noTools = option('text-only', {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    });
    const unavailable = option(
      'unavailable',
      {
        inputTypes: ['text'],
        streaming: true,
        structuredOutput: false,
        toolCalling: true,
      },
      { status: 'unavailable', message: '모델을 사용할 수 없어요.' },
    );

    expect(
      filterSelectableProviders(
        [apple, chatGPT, noTools, unavailable],
        requirements,
      ),
    ).toEqual([apple, chatGPT]);
  });

  it('checks structured output only when the selected workflow requires it', () => {
    const chatGPT = option('chatgpt-plan:account:model-a', {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: true,
    });

    expect(filterSelectableProviders([chatGPT], requirements)).toEqual([
      chatGPT,
    ]);
    expect(
      filterSelectableProviders([chatGPT], {
        ...requirements,
        structuredOutput: true,
      }),
    ).toEqual([]);
  });
});

describe('provider selection resolution', () => {
  it('requires an explicit selection and never chooses the first available provider', () => {
    const apple = option('apple-foundation-models', {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
    });

    expect(resolveProviderSelection(null, [apple], requirements)).toEqual({
      ok: false,
      reason: 'selection-required',
    });
  });

  it('does not fall back when the previously selected remote provider is unavailable', () => {
    const apple = option('apple-foundation-models', {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
    });
    const chatGPT = option(
      'chatgpt-plan:account:model-a',
      {
        inputTypes: ['text'],
        streaming: true,
        structuredOutput: false,
        toolCalling: true,
      },
      { status: 'unavailable', message: 'ChatGPT 계정을 확인할 수 없어요.' },
    );

    expect(
      resolveProviderSelection(
        { providerId: chatGPT.provider.id, modelId: chatGPT.modelId },
        [apple, chatGPT],
        requirements,
      ),
    ).toEqual({
      ok: false,
      reason: 'provider-unavailable',
      message: 'ChatGPT 계정을 확인할 수 없어요.',
    });
  });

  it('resolves only the exact provider and model identifiers', () => {
    const apple = option('apple-foundation-models', {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
    });

    expect(
      resolveProviderSelection(
        { providerId: apple.provider.id, modelId: apple.modelId },
        [apple],
        requirements,
      ),
    ).toEqual({ ok: true, provider: apple.provider });
    expect(
      resolveProviderSelection(
        { providerId: apple.provider.id, modelId: 'different-model' },
        [apple],
        requirements,
      ),
    ).toEqual({ ok: false, reason: 'selection-unavailable' });
  });
});
