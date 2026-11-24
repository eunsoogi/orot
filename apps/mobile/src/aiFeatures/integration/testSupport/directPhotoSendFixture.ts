import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeBridge,
  type ChatGPTPlanNativeEvent,
} from '@orot/provider-openai';
import { t } from '../../../i18n';
import type { SelectedAiResolution } from '../provider';
import { type ConversationPhotoImageDecision } from '../sendConversationPhotoImage';

export const syntheticDirectJPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIABADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCMtmAD/9k=';

export function setupPhotoSend(
  options: {
    supportsPhoto?: boolean;
    hasTransport?: boolean;
    approve?: boolean;
    holdNative?: boolean;
    onSubscribe?: () => void;
  } = {},
) {
  const controller = new AbortController();
  let listener: ((event: ChatGPTPlanNativeEvent) => void) | undefined;
  let invalidate: (() => void) | undefined;
  let current = true;
  type Start = NonNullable<ChatGPTPlanNativeBridge['startPhotoResponse']>;
  const startPhotoResponse = jest.fn<ReturnType<Start>, Parameters<Start>>(
    async id => {
      if (options.holdNative) return;
      listener?.({
        requestId: id,
        type: 'response_started',
        responseId: 'synthetic',
      });
      listener?.({ requestId: id, type: 'text_delta', text: '합성 사진 설명' });
      listener?.({ requestId: id, type: 'completed', text: '합성 사진 설명' });
    },
  );
  const ordinaryStart = jest.fn(async () => {});
  const cancelResponse = jest.fn();
  const bridge: ChatGPTPlanNativeBridge = {
    startResponse: ordinaryStart,
    ...(options.hasTransport !== false ? { startPhotoResponse } : {}),
    cancelResponse,
    listModels: async () => [],
    subscribe(handler) {
      listener = handler;
      options.onSubscribe?.();
      return () => {
        listener = undefined;
      };
    },
  };
  const provider = createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'synthetic-owner',
    model: {
      slug: 'synthetic-declared-model',
      displayName: 'Synthetic model',
      supportsDirectPhoto: options.supportsPhoto !== false,
    },
    requestIDFactory: () => 'one-synthetic-request',
  });
  const selected: Extract<SelectedAiResolution, { status: 'ready' }> = {
    status: 'ready',
    provider,
    modelId: 'synthetic-declared-model',
    recipient: t('nextVisit.recipient.chatgpt'),
    remoteProcessing: true,
    option: {
      provider,
      modelId: 'synthetic-declared-model',
      displayName: 'Synthetic model',
      privacyBoundary: 'selected-context-remote',
      availability: { status: 'available' },
    },
    selection: { providerId: provider.id, modelId: 'synthetic-declared-model' },
  };
  const confirm = jest.fn<
    Promise<boolean>,
    [ConversationPhotoImageDecision, AbortSignal]
  >(async () => options.approve ?? true);
  const input = {
    selected,
    jpegBase64: syntheticDirectJPEG,
    prompt: '',
    signal: controller.signal,
    isCurrent: () => current,
    subscribeInvalidation(callback: () => void) {
      invalidate = callback;
      return () => {
        invalidate = undefined;
      };
    },
    confirm,
  };
  return {
    input,
    controller,
    startPhotoResponse,
    ordinaryStart,
    cancelResponse,
    retire() {
      current = false;
      invalidate?.();
    },
  };
}
