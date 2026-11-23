import type { LanguageModelProvider } from '@orot/model-runtime';
import { warmConversationProviderGuard } from '../warmConversationProviderGuard';

test.each(['volatile epoch', 'durable owner'])(
  '%s loss after provider resolution cannot enter any warm transport',
  async lost => {
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'synthetic',
      displayName: 'Synthetic',
      capabilities: {
        inputTypes: ['text'],
        streaming: true,
        structuredOutput: false,
        toolCalling: true,
      },
      generate: jest.fn(async () => {
        throw new Error('not an authorized call');
      }),
      stream: jest.fn(async function* () {
        yield await Promise.reject(new Error('not an authorized call'));
      }),
      searchPublicWeb: jest.fn(async () => {
        throw new Error('not an authorized call');
      }),
    };
    let allowed = true;
    let owner = true;
    const recheckOwner = jest.fn(async () => owner);
    const guarded = warmConversationProviderGuard(
      provider,
      () => allowed,
      recheckOwner,
    );
    const lazy = guarded.stream!({ messages: [] } as never);
    if (lost === 'volatile epoch') allowed = false;
    else owner = false;
    const blocked = { ok: false, error: { code: 'provider_unavailable' } };
    await expect(
      guarded.generate({ messages: [] } as never),
    ).resolves.toMatchObject(blocked);
    await expect(lazy[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: blocked,
    });
    await expect(
      guarded.searchPublicWeb!({ query: 'synthetic' }),
    ).resolves.toMatchObject(blocked);
    expect(recheckOwner).toHaveBeenCalledTimes(
      lost === 'durable owner' ? 3 : 0,
    );
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.stream).not.toHaveBeenCalled();
    expect(provider.searchPublicWeb).not.toHaveBeenCalled();
  },
);
