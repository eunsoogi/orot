import { NativeEventEmitter, NativeModules } from 'react-native';
import type { LanguageModelResponse } from '@orot/model-runtime';
import type {
  AppleFoundationModelsNativeBridge,
  AppleModelAvailability,
  AppleNativeStreamPacket,
} from '@orot/provider-apple';
import type { AppleNativeRequest } from './schema';
import { serializeAppleRequest } from './serializeRequest';

const EVENT_NAME = 'AppleFoundationModelsEvent';

interface NativeAppleModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  getAvailability(): Promise<AppleModelAvailability>;
  generate(
    request: AppleNativeRequest,
    requestId: string,
  ): Promise<LanguageModelResponse>;
  startStream(request: AppleNativeRequest, requestId: string): void;
  cancel(requestId: string): void;
}

interface NativeAppleEvent {
  readonly requestId: string;
  readonly packet: AppleNativeStreamPacket;
}

const nativeModule = NativeModules.AppleFoundationModelsModule as
  NativeAppleModule | undefined;
const emitter = nativeModule ? new NativeEventEmitter(nativeModule) : undefined;

export const appleFoundationModelsNativeBridge: AppleFoundationModelsNativeBridge =
  {
    async getAvailability() {
      if (!nativeModule) throw bridgeUnavailable();
      return nativeModule.getAvailability();
    },

    async generate(request, requestId) {
      if (!nativeModule) throw bridgeUnavailable();
      return nativeModule.generate(serializeAppleRequest(request), requestId);
    },

    stream(request, requestId) {
      try {
        return createNativeStream(serializeAppleRequest(request), requestId);
      } catch (error) {
        return singleError(error);
      }
    },

    cancel(requestId) {
      nativeModule?.cancel(requestId);
    },
  };

async function* createNativeStream(
  request: AppleNativeRequest,
  requestId: string,
): AsyncIterable<AppleNativeStreamPacket> {
  if (!nativeModule || !emitter) {
    yield {
      type: 'error',
      code: 'NATIVE_MODULE_UNAVAILABLE',
      message: 'Apple Foundation Models native bridge is not registered.',
    };
    return;
  }

  const packets: AppleNativeStreamPacket[] = [];
  let wake: (() => void) | undefined;
  let terminal = false;
  const subscription = emitter.addListener(
    EVENT_NAME,
    (...args: readonly Object[]) => {
      const event = args[0] as unknown as NativeAppleEvent | undefined;
      if (!event || event.requestId !== requestId || !isPacket(event.packet))
        return;
      packets.push(event.packet);
      wake?.();
      wake = undefined;
    },
  );

  try {
    nativeModule.startStream(request, requestId);
    while (!terminal) {
      if (packets.length === 0) {
        await new Promise<void>(resolve => {
          wake = resolve;
        });
      }
      const packet = packets.shift();
      if (!packet) continue;
      terminal =
        packet.type === 'completed' ||
        packet.type === 'cancelled' ||
        packet.type === 'error';
      yield packet;
    }
  } finally {
    subscription.remove();
    if (!terminal) nativeModule.cancel(requestId);
  }
}

async function* singleError(
  error: unknown,
): AsyncIterable<AppleNativeStreamPacket> {
  const value = error as { code?: unknown; message?: unknown };
  yield {
    type: 'error',
    code: typeof value?.code === 'string' ? value.code : 'INVALID_REQUEST',
    message:
      typeof value?.message === 'string'
        ? value.message
        : 'Apple model request is invalid.',
  };
}

function isPacket(value: unknown): value is AppleNativeStreamPacket {
  if (!value || typeof value !== 'object') return false;
  const packet = value as Record<string, unknown>;
  if (packet.type === 'snapshot') return typeof packet.text === 'string';
  if (packet.type === 'completed') return Boolean(packet.response);
  if (packet.type === 'cancelled') return true;
  return (
    packet.type === 'error' &&
    typeof packet.code === 'string' &&
    typeof packet.message === 'string'
  );
}

function bridgeUnavailable(): Error {
  const error = new Error(
    'Apple Foundation Models native bridge is not registered.',
  );
  Object.assign(error, { code: 'NATIVE_MODULE_UNAVAILABLE' });
  return error;
}
