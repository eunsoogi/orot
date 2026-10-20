import { describe, expect, it } from '@jest/globals';
import {
  InMemoryFakeLanguageModelProvider,
  InMemoryProviderRegistry,
  providerSuccess,
  type EmbeddingProvider,
  type LanguageModelProvider,
} from '../src';

describe('InMemoryProviderRegistry', () => {
  it('looks up providers by kind and allows the same id for different kinds', () => {
    const registry = new InMemoryProviderRegistry();
    const languageModel = new InMemoryFakeLanguageModelProvider({ id: 'shared' });
    const embeddings: EmbeddingProvider = {
      kind: 'embedding',
      id: 'shared',
      displayName: 'Fake embeddings',
      capabilities: { inputTypes: ['text'] },
      async embed({ input }) {
        return providerSuccess({ vectors: input.map(() => [0.5, 0.25]) });
      },
    };

    expect(registry.register(languageModel)).toEqual({ ok: true, value: undefined });
    expect(registry.register(embeddings)).toEqual({ ok: true, value: undefined });
    expect(registry.get('language-model', 'shared')).toBe(languageModel);
    expect(registry.get('embedding', 'shared')).toBe(embeddings);
    expect(registry.get('transcription', 'shared')).toBeUndefined();
    expect(registry.list('language-model')).toEqual([languageModel]);
  });

  it('rejects duplicate ids within a kind without replacing the original', () => {
    const registry = new InMemoryProviderRegistry();
    const original = new InMemoryFakeLanguageModelProvider({ id: 'duplicate' });
    const replacement = new InMemoryFakeLanguageModelProvider({ id: 'duplicate' });
    registry.register(original);

    expect(registry.register(replacement)).toMatchObject({
      ok: false,
      error: { code: 'duplicate_provider', retryable: false },
    });
    expect(registry.get('language-model', 'duplicate')).toBe(original);
  });

  it('rejects providers whose advertised capabilities lack a matching method', () => {
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'broken-stream',
      displayName: 'Broken stream provider',
      capabilities: {
        inputTypes: ['text'],
        streaming: true,
        toolCalling: false,
        structuredOutput: false,
      },
      async generate() {
        return providerSuccess({ text: '', toolCalls: [], finishReason: 'complete' });
      },
    };

    expect(new InMemoryProviderRegistry().register(provider)).toMatchObject({
      ok: false,
      error: { code: 'invalid_provider', retryable: false },
    });
  });

  it('preserves an optional public search method and rejects a malformed declaration', () => {
    const original = new InMemoryFakeLanguageModelProvider({ id: 'public-capable' });
    const searchPublicWeb = async () =>
      providerSuccess({ text: 'Synthetic', callCount: 1, citations: [] });
    const valid = Object.assign(original, { searchPublicWeb });
    const registry = new InMemoryProviderRegistry();
    expect(registry.register(valid).ok).toBe(true);
    expect(registry.get('language-model', valid.id)?.searchPublicWeb).toBe(searchPublicWeb);
    const invalid = Object.assign(new InMemoryFakeLanguageModelProvider(), {
      searchPublicWeb: true,
    }) as unknown as LanguageModelProvider;
    expect(new InMemoryProviderRegistry().register(invalid)).toMatchObject({
      ok: false,
      error: { code: 'invalid_provider' },
    });
  });
});
