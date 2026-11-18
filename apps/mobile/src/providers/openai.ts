import {
  cancelPendingChatGPTConsentSignIn,
  mutateChatGPTConsentCredential,
} from './chatGPTConsentIdentity';
import {
  isNativeEnvelope,
  isPacket,
  type NativeOpenAIProviderEvent,
} from './openaiNativeEvent';
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
  ChatGPTPlanRequest,
  ChatGPTPlanPublicWebRequest,
} from '@orot/provider-openai';

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
  startSteerableResponse?(
    request: ChatGPTPlanRequest,
    requestId: string,
    issuedClientID: string,
  ): void;
  steerResponse?(
    requestId: string,
    submissionId: string,
    text: string,
  ): Promise<void>;
  cancelResponse(requestId: string): void;
}

export type OpenAISignOutResult = 'revoked' | 'localCredentialsCleared';

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

  ...(nativeModule?.startSteerableResponse && nativeModule.steerResponse
    ? {
        async startSteerableResponse(
          requestId: string,
          issuedClientID: string,
          request: ChatGPTPlanRequest,
        ) {
          nativeModule.startSteerableResponse!(
            request,
            requestId,
            issuedClientID,
          );
        },
        async steerResponse(
          requestId: string,
          submissionId: string,
          text: string,
        ) {
          await nativeModule.steerResponse!(requestId, submissionId, text);
        },
      }
    : {}),

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
  return mutateChatGPTConsentCredential(
    async () =>
      readAccountSummary(
        await nativeModule.signIn(existingIssuedClientID ?? null),
      ),
    false,
  );
}

export function cancelOpenAISignIn(): void {
  cancelPendingChatGPTConsentSignIn();
  nativeModule?.cancelSignIn();
}

export async function signOutFromOpenAI(
  issuedClientID: string,
): Promise<OpenAISignOutResult> {
  if (!nativeModule?.signOut) throw bridgeUnavailable();
  if (!isIssuedClientID(issuedClientID)) throw invalidAccountSummary();
  const result = await mutateChatGPTConsentCredential(
    () => nativeModule.signOut(issuedClientID),
    true,
  );
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

function bridgeUnavailable(): Error {
  const error = new Error('The ChatGPT plan native bridge is not registered.');
  Object.assign(error, {
    code: 'NATIVE_MODULE_UNAVAILABLE',
    kind: 'provider' satisfies ChatGPTPlanNativeError['kind'],
  });
  return error;
}
