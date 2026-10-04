import { NativeEventEmitter, NativeModules } from 'react-native';
import {
  createChatGPTPlanProvider,
  listChatGPTPlanModels,
} from '@orot/provider-openai';
import type {
  ChatGPTPlanModel,
  ChatGPTPlanModelDescriptor,
  ChatGPTPlanNativeBridge,
  ChatGPTPlanNativeError,
  ChatGPTPlanRequest,
} from '@orot/provider-openai';

const EVENT_NAME = 'OpenAIProviderEvent';

interface NativeOpenAIProviderModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  listModels(
    issuedClientID: string,
  ): Promise<readonly ChatGPTPlanModelDescriptor[]>;
  startResponse(
    request: ChatGPTPlanRequest,
    requestId: string,
    issuedClientID: string,
  ): void;
  cancelResponse(requestId: string): void;
}

interface NativeOpenAIProviderEvent {
  readonly requestId: string;
  readonly packet: NativeOpenAIProviderPacket;
}

type NativeOpenAIProviderPacket =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'completed'; readonly text: string }
  | { readonly type: 'failed'; readonly error: ChatGPTPlanNativeError };

const nativeModule = NativeModules.OpenAIProviderModule as
  NativeOpenAIProviderModule | undefined;
const emitter = nativeModule
  ? new NativeEventEmitter(NativeModules.OpenAIProviderModule)
  : undefined;

export const chatGPTPlanNativeBridge: ChatGPTPlanNativeBridge = {
  async listModels(issuedClientID) {
    if (!nativeModule) throw bridgeUnavailable();
    return nativeModule.listModels(issuedClientID);
  },

  subscribe(listener) {
    if (!emitter) return () => {};
    const subscription = emitter.addListener(
      EVENT_NAME,
      (...args: readonly Object[]) => {
        const value = args[0] as unknown as
          NativeOpenAIProviderEvent | undefined;
        if (!isNativeEvent(value)) return;
        listener({ requestId: value.requestId, ...value.packet });
      },
    );
    return () => subscription.remove();
  },

  async startResponse(requestId, issuedClientID, request) {
    if (!nativeModule) throw bridgeUnavailable();
    nativeModule.startResponse(request, requestId, issuedClientID);
  },

  cancelResponse(requestId) {
    nativeModule?.cancelResponse(requestId);
  },
};

export async function listOpenAIPlanModels(
  issuedClientID: string,
): Promise<Awaited<ReturnType<typeof listChatGPTPlanModels>>> {
  return listChatGPTPlanModels(chatGPTPlanNativeBridge, issuedClientID);
}

export function createOpenAIPlanProvider(
  issuedClientID: string,
  model: ChatGPTPlanModelDescriptor | ChatGPTPlanModel,
) {
  return createChatGPTPlanProvider({
    bridge: chatGPTPlanNativeBridge,
    issuedClientID,
    model,
  });
}

function isNativeEvent(value: unknown): value is NativeOpenAIProviderEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.requestId === 'string' && isPacket(event.packet);
}

function isPacket(value: unknown): value is NativeOpenAIProviderPacket {
  if (!value || typeof value !== 'object') return false;
  const packet = value as Record<string, unknown>;
  if (packet.type === 'text_delta' || packet.type === 'completed')
    return typeof packet.text === 'string';
  if (
    packet.type !== 'failed' ||
    !packet.error ||
    typeof packet.error !== 'object'
  )
    return false;
  const error = packet.error as Record<string, unknown>;
  return typeof error.kind === 'string' || typeof error.code === 'string';
}

function bridgeUnavailable(): Error {
  const error = new Error('The ChatGPT plan native bridge is not registered.');
  Object.assign(error, {
    code: 'NATIVE_MODULE_UNAVAILABLE',
    kind: 'provider' satisfies ChatGPTPlanNativeError['kind'],
  });
  return error;
}
