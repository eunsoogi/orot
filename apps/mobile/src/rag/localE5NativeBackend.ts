import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  LocalEmbeddingBackend,
  LocalEmbeddingModelIdentity,
  LocalEmbeddingRole,
} from '@orot/rag';

const PROGRESS_EVENT = 'LocalE5EmbeddingEvent';
const TOTAL_MODEL_BYTES = 475_337_561;

interface LocalE5ProgressEvent {
  readonly requestId: string;
  readonly completed: number;
  readonly total: number;
}

export interface LocalE5NativeModule {
  getModelIdentity(): Promise<LocalEmbeddingModelIdentity>;
  prepare(requestId: string): Promise<unknown>;
  embedBatch(
    input: readonly string[],
    role: LocalEmbeddingRole,
    requestId: string,
  ): Promise<readonly (readonly number[])[]>;
  cancel(requestId: string): void;
}

interface LocalE5EventSource {
  addListener(
    eventName: string,
    listener: (event: unknown) => void,
  ): { remove(): void };
}

function isProgressEvent(event: unknown): event is LocalE5ProgressEvent {
  if (!event || typeof event !== 'object') return false;
  const value = event as Partial<LocalE5ProgressEvent>;
  return (
    typeof value.requestId === 'string' &&
    typeof value.completed === 'number' &&
    typeof value.total === 'number'
  );
}

export function createLocalE5NativeBackend(
  module: LocalE5NativeModule,
  events: LocalE5EventSource,
): LocalEmbeddingBackend {
  return {
    async prepare(requestId, onProgress) {
      const subscription = events.addListener(PROGRESS_EVENT, event => {
        if (isProgressEvent(event) && event.requestId === requestId) {
          onProgress(event.completed, event.total);
        }
      });
      try {
        await module.prepare(requestId);
        // The bridge may enqueue its final event as the promise resolves, so report the verified completed state here too.
        onProgress(TOTAL_MODEL_BYTES, TOTAL_MODEL_BYTES);
      } finally {
        subscription.remove();
      }
    },
    embedBatch(input, role, requestId) {
      return module.embedBatch(input, role, requestId);
    },
    cancel(requestId) {
      module.cancel(requestId);
    },
  };
}

function nativeBackend(): LocalEmbeddingBackend {
  const module = NativeModules.LocalE5EmbeddingModule as
    LocalE5NativeModule | undefined;
  if (!module) {
    throw Object.assign(
      new Error('The on-device multilingual embedding module is unavailable.'),
      { code: 'NATIVE_MODULE_UNAVAILABLE' },
    );
  }
  const eventModule = module as unknown as ConstructorParameters<
    typeof NativeEventEmitter
  >[0];
  return createLocalE5NativeBackend(
    module,
    new NativeEventEmitter(eventModule),
  );
}

let backend: LocalEmbeddingBackend | null = null;

function requireBackend(): LocalEmbeddingBackend {
  backend ??= nativeBackend();
  return backend;
}

export const localE5NativeBackend: LocalEmbeddingBackend = {
  prepare(requestId, onProgress) {
    return requireBackend().prepare(requestId, onProgress);
  },
  embedBatch(input, role, requestId) {
    return requireBackend().embedBatch(input, role, requestId);
  },
  cancel(requestId) {
    if (backend) backend.cancel(requestId);
    else {
      const module = NativeModules.LocalE5EmbeddingModule as
        LocalE5NativeModule | undefined;
      module?.cancel(requestId);
    }
  },
};

export async function getLocalE5NativeModelIdentity(): Promise<LocalEmbeddingModelIdentity> {
  const module = NativeModules.LocalE5EmbeddingModule as
    LocalE5NativeModule | undefined;
  if (!module) {
    throw Object.assign(
      new Error('The on-device multilingual embedding module is unavailable.'),
      { code: 'NATIVE_MODULE_UNAVAILABLE' },
    );
  }
  return module.getModelIdentity();
}

export interface LocalE5NativeRuntimeMetrics {
  readonly modelLoaded: boolean;
  readonly downloadMilliseconds: number | null;
  readonly sessionLoadMilliseconds: number | null;
  readonly footprintBeforeLoadBytes: number | null;
  readonly footprintAfterLoadBytes: number | null;
  readonly inferenceMilliseconds: number | null;
  readonly inferencePeakFootprintBytes: number | null;
  readonly executionProvider: string;
}

export async function getLocalE5NativeRuntimeMetrics(): Promise<LocalE5NativeRuntimeMetrics> {
  const module = NativeModules.LocalE5EmbeddingModule as
    | (LocalE5NativeModule & {
        getRuntimeMetrics(): Promise<LocalE5NativeRuntimeMetrics>;
      })
    | undefined;
  if (!module) {
    throw Object.assign(
      new Error('The on-device multilingual embedding module is unavailable.'),
      { code: 'NATIVE_MODULE_UNAVAILABLE' },
    );
  }
  return module.getRuntimeMetrics();
}
