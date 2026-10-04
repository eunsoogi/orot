import type { LanguageModelRequest, LanguageModelResponse } from '@orot/model-runtime';

export type AppleAvailabilityStatus =
  'available' | 'disabled' | 'modelNotReady' | 'unsupportedDevice' | 'unsupportedLanguage';

export interface AppleModelAvailability {
  readonly status: AppleAvailabilityStatus;
  readonly detail?: string;
}

export interface AppleCancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface AppleGenerationOptions {
  readonly signal?: AppleCancellationSignal;
}

export type AppleNativeStreamPacket =
  | { readonly type: 'snapshot'; readonly text: string }
  | { readonly type: 'completed'; readonly response: LanguageModelResponse }
  | { readonly type: 'cancelled' }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
      readonly status?: AppleAvailabilityStatus;
    };

export interface AppleFoundationModelsNativeBridge {
  getAvailability(): Promise<AppleModelAvailability>;
  generate(request: LanguageModelRequest, requestId: string): Promise<LanguageModelResponse>;
  stream(request: LanguageModelRequest, requestId: string): AsyncIterable<AppleNativeStreamPacket>;
  cancel(requestId: string): void;
}
