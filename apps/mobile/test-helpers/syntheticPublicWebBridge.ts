import { providerSuccess } from '@orot/model-runtime';
import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { nativeChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import { FakeBridge } from '../../../packages/provider-openai/__tests__/providerTestSupport';
import { chatGPTPlanNativeBridge } from '../src/providers/openai';

export const title = 'Synthetic public source';
export const sourceUrl = 'https://example.org/source';
export const finished =
  '합성 공개 자료에는 추가 확인이 필요하다고 적혀 있어요.';
export const account = 'synthetic-account';
export const model = {
  id: 'gpt-synthetic',
  slug: 'gpt-synthetic',
  displayName: 'Synthetic model',
};
export const providerId = `chatgpt-plan:${account}:${model.slug}`;

export function syntheticBridge(invalidCitation: boolean) {
  const citedIds: string[][] = [];
  const bridge = new FakeBridge(async (id, target) => {
    const request = target.started.at(-1)?.request;
    const ids = (request?.messages.flatMap(message => {
      if (
        !('role' in message) ||
        message.role !== 'user' ||
        typeof message.content !== 'string'
      )
        return [];
      try {
        const input = JSON.parse(message.content);
        return Array.isArray(input.evidence)
          ? input.evidence.map(
              (item: { evidenceId: string }) => item.evidenceId,
            )
          : [];
      } catch {
        return [];
      }
    }) ?? []) as string[];
    const call = target.started.length;
    if (call > 2) citedIds.push(ids);
    const text =
      call === 1
        ? '합성 질문을 살펴볼게요.'
        : call === 2
          ? 'ALLOW'
          : JSON.stringify({
              type: 'result',
              value: { answerKind: 'grounded', answer: finished },
              // Echo only the evidence IDs the real graph fed into the scripted adapter.
              citations: invalidCitation
                ? ['not-an-authorized-reference']
                : ids,
            });
    target.emit({
      requestId: id,
      type: 'response_started',
      responseId: `response-${id}`,
    });
    target.emit({ requestId: id, type: 'text_delta', text });
    target.emit({ requestId: id, type: 'completed', text });
  });
  const publicWeb = jest.fn<
    ReturnType<
      NonNullable<typeof chatGPTPlanNativeBridge.startPublicWebSearch>
    >,
    Parameters<NonNullable<typeof chatGPTPlanNativeBridge.startPublicWebSearch>>
  >(async id => {
    bridge.emit({
      requestId: id,
      type: 'response_started',
      responseId: 'synthetic-web-response',
    });
    const text = 'Synthetic public source: further assessment is needed.';
    bridge.emit({ requestId: id, type: 'text_delta', text });
    bridge.emit({
      requestId: id,
      type: 'completed',
      text,
      webSearch: { callCount: 1, citations: [{ title, url: sourceUrl }] },
    });
  });
  jest
    .spyOn(chatGPTPlanNativeBridge, 'subscribe')
    .mockImplementation(bridge.subscribe.bind(bridge));
  jest
    .spyOn(chatGPTPlanNativeBridge, 'startResponse')
    .mockImplementation(bridge.startResponse.bind(bridge));
  jest
    .spyOn(chatGPTPlanNativeBridge, 'cancelResponse')
    .mockImplementation(bridge.cancelResponse.bind(bridge));
  jest
    .spyOn(chatGPTPlanNativeBridge, 'startPublicWebSearch')
    .mockImplementation(publicWeb);
  return { bridge, publicWeb, citedIds };
}

/** Substitute only native Keychain and catalog inputs; the real Settings writer owns the grant. */
export function installSyntheticWebAccount() {
  const passwords = new Map<string, string>();
  jest.mocked(getGenericPassword).mockImplementation(async options => {
    const service = options?.service ?? '';
    const password = passwords.get(service);
    return password
      ? {
          password,
          service,
          username: 'synthetic',
          storage: STORAGE_TYPE.RSA,
        }
      : false;
  });
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (_user, password, options) => {
      const service = options?.service ?? '';
      passwords.set(service, password);
      return { service, storage: STORAGE_TYPE.RSA };
    });
  jest.spyOn(nativeChatGPTSelectionServices, 'listAccounts').mockResolvedValue([
    {
      issuedClientID: account,
      requiresSignIn: false,
      hasDirectPlanAccess: true,
    },
  ]);
  jest
    .spyOn(nativeChatGPTSelectionServices, 'listModels')
    .mockImplementation(async issuedClientID => {
      if (issuedClientID !== account)
        throw new Error('Unexpected synthetic catalog owner');
      return providerSuccess([model]);
    });
}
