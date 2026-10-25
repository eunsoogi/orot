import { NativeEventEmitter, NativeModules } from 'react-native';
import {
  readAccountSummary,
  isIssuedClientID,
  invalidAccountSummary,
} from './openaiAccountSummary';
import type { OpenAIAccountSummary } from './openaiAccountSummary';
export type { OpenAIAccountSummary } from './openaiAccountSummary';
import {
  createChatGPTPlanProvider,
  listChatGPTPlanModels,
} from '@orot/provider-openai';
import type {
  ChatGPTPlanModel,
  ChatGPTPlanModelDescriptor,
  ChatGPTPlanNativeBridge,
  ChatGPTPlanNativeError,
  ChatGPTPlanNativeToolCall,
  ChatGPTPlanRequest,
  ChatGPTPlanPublicWebRequest,
  ChatGPTPlanWebSearchResult,
} from '@orot/provider-openai';
import type { LanguageModelResponse } from '@orot/model-runtime';

const EVENT_NAME = 'OpenAIProviderEvent';

interface NativeOpenAIProviderModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  listAccounts(): Promise<readonly unknown[]>;
  signIn(existingIssuedClientID: string | null): Promise<unknown>;
  cancelSignIn(): void;
  signOut(issuedClientID: string): Promise<unknown>;
  listModels(
    issuedClientID: string,
  ): Promise<readonly ChatGPTPlanModelDescriptor[]>;
  startResponse(
    request: ChatGPTPlanRequest | ChatGPTPlanPublicWebRequest,
    requestId: string,
    issuedClientID: string,
  ): void;
  cancelResponse(requestId: string): void;
}

export type OpenAISignOutResult = 'revoked' | 'localCredentialsCleared';

interface NativeOpenAIProviderEvent {
  readonly requestId: string;
  readonly packet: NativeOpenAIProviderPacket;
}

type NativeOpenAIProviderPacket =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'tool_call'; readonly toolCall: ChatGPTPlanNativeToolCall }
  | {
      readonly type: 'completed';
      readonly text: string;
      readonly toolCalls?: readonly ChatGPTPlanNativeToolCall[];
      readonly continuationItems?: readonly string[];
      readonly webSearch?: ChatGPTPlanWebSearchResult;
      readonly usage?: LanguageModelResponse['usage'];
    }
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
        if (!isNativeEnvelope(value)) return;
        if (!isPacket(value.packet)) {
          nativeModule?.cancelResponse(value.requestId);
          listener({
            requestId: value.requestId,
            type: 'failed',
            error: { kind: 'malformed_response' },
          });
          return;
        }
        listener({ requestId: value.requestId, ...value.packet });
      },
    );
    return () => subscription.remove();
  },

  async startResponse(requestId, issuedClientID, request) {
    if (!nativeModule) throw bridgeUnavailable();
    nativeModule.startResponse(request, requestId, issuedClientID);
  },

  async startPublicWebSearch(requestId, issuedClientID, request) {
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

export async function listOpenAIAccounts(): Promise<
  readonly OpenAIAccountSummary[]
> {
  if (!nativeModule?.listAccounts) throw bridgeUnavailable();
  const values = await nativeModule.listAccounts();
  if (!Array.isArray(values)) throw invalidAccountSummary();
  const summaries = values.map(readAccountSummary);
  const identifiers = summaries.map(summary => summary.issuedClientID);
  if (new Set(identifiers).size !== identifiers.length) {
    throw invalidAccountSummary();
  }
  return summaries;
}

export async function signInToOpenAI(
  existingIssuedClientID?: string,
): Promise<OpenAIAccountSummary> {
  if (!nativeModule?.signIn) throw bridgeUnavailable();
  if (
    existingIssuedClientID !== undefined &&
    !isIssuedClientID(existingIssuedClientID)
  ) {
    throw invalidAccountSummary();
  }
  return readAccountSummary(
    await nativeModule.signIn(existingIssuedClientID ?? null),
  );
}

export function cancelOpenAISignIn(): void {
  nativeModule?.cancelSignIn();
}

export async function signOutFromOpenAI(
  issuedClientID: string,
): Promise<OpenAISignOutResult> {
  if (!nativeModule?.signOut) throw bridgeUnavailable();
  if (!isIssuedClientID(issuedClientID)) throw invalidAccountSummary();
  const result = await nativeModule.signOut(issuedClientID);
  if (result !== 'revoked' && result !== 'localCredentialsCleared') {
    throw invalidAccountSummary();
  }
  return result;
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

function isNativeEnvelope(value: unknown): value is NativeOpenAIProviderEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.requestId === 'string';
}

function isPacket(value: unknown): value is NativeOpenAIProviderPacket {
  if (!value || typeof value !== 'object') return false;
  const packet = value as Record<string, unknown>;
  if (packet.type === 'text_delta') return typeof packet.text === 'string';
  if (packet.type === 'tool_call') return isToolCall(packet.toolCall);
  if (packet.type === 'completed') {
    return (
      typeof packet.text === 'string' &&
      (packet.toolCalls === undefined ||
        (Array.isArray(packet.toolCalls) &&
          packet.toolCalls.every(isToolCall))) &&
      (packet.continuationItems === undefined ||
        (Array.isArray(packet.continuationItems) &&
          packet.continuationItems.every(item => typeof item === 'string'))) &&
      isUsage(packet.usage)
    );
  }
  if (
    packet.type !== 'failed' ||
    !packet.error ||
    typeof packet.error !== 'object'
  )
    return false;
  const error = packet.error as Record<string, unknown>;
  return typeof error.kind === 'string' || typeof error.code === 'string';
}

/** Validate all reported counts before crossing the untyped native event boundary. */
function isUsage(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return [usage.inputTokens, usage.outputTokens, usage.totalTokens].every(
    count =>
      typeof count === 'number' && Number.isSafeInteger(count) && count >= 0,
  );
}

function isToolCall(value: unknown): value is ChatGPTPlanNativeToolCall {
  if (!value || typeof value !== 'object') return false;
  const toolCall = value as Record<string, unknown>;
  return (
    typeof toolCall.id === 'string' &&
    typeof toolCall.name === 'string' &&
    typeof toolCall.arguments === 'string'
  );
}

function bridgeUnavailable(): Error {
  const error = new Error('The ChatGPT plan native bridge is not registered.');
  Object.assign(error, {
    code: 'NATIVE_MODULE_UNAVAILABLE',
    kind: 'provider' satisfies ChatGPTPlanNativeError['kind'],
  });
  return error;
}
