export type ProviderId = string;

export type ProviderInputType = 'audio' | 'image' | 'text';

export type JsonValue =
  boolean | null | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

export type ProviderErrorCode =
  | 'authentication_required'
  | 'credential_unavailable'
  | 'duplicate_provider'
  | 'internal_error'
  | 'invalid_provider'
  | 'invalid_request'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'unsupported_capability'
  | 'unsupported_input';

export interface ProviderError {
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ProviderResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ProviderError };

export function providerSuccess<T>(value: T): ProviderResult<T> {
  return { ok: true, value };
}

export function providerFailure<T = never>(error: ProviderError): ProviderResult<T> {
  return { ok: false, error };
}

export interface ProviderCapabilities {
  readonly inputTypes: readonly ProviderInputType[];
}

export interface LanguageModelCapabilities extends ProviderCapabilities {
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly toolCalling: boolean;
}

export interface TranscriptionCapabilities extends ProviderCapabilities {
  readonly streaming: boolean;
}

export type EmbeddingCapabilities = ProviderCapabilities;

export type LanguageModelInputPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image' | 'audio'; readonly data: Uint8Array; readonly mediaType: string };

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export interface ToolCallResult {
  readonly toolCallId: string;
  readonly result: JsonValue;
}

export type LanguageModelMessage =
  | {
      readonly role: 'system' | 'user';
      readonly content: string | readonly LanguageModelInputPart[];
    }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly toolCalls?: readonly ToolCall[];
    }
  | ({ readonly role: 'tool' } & ToolCallResult);

export interface StructuredOutputFormat {
  readonly name: string;
  readonly schema: JsonObject;
}

export interface LanguageModelRequest {
  readonly messages: readonly LanguageModelMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly responseFormat?: StructuredOutputFormat;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export type LanguageModelFinishReason =
  'complete' | 'content_filtered' | 'length_limit' | 'tool_calls';

export interface LanguageModelResponse {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly structuredOutput?: JsonValue;
  readonly finishReason: LanguageModelFinishReason;
}

export type LanguageModelStreamEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'tool_call'; readonly toolCall: ToolCall }
  | { readonly type: 'completed'; readonly response: LanguageModelResponse };

export interface LanguageModelProvider {
  readonly kind: 'language-model';
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: LanguageModelCapabilities;
  generate(request: LanguageModelRequest): Promise<ProviderResult<LanguageModelResponse>>;
  stream?(request: LanguageModelRequest): AsyncIterable<ProviderResult<LanguageModelStreamEvent>>;
}

export interface AudioInput {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

export interface TranscriptionRequest {
  readonly audio: AudioInput;
  readonly language?: string;
}

export interface TranscriptionSegment {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface TranscriptionResponse {
  readonly text: string;
  readonly language?: string;
  readonly segments?: readonly TranscriptionSegment[];
}

export type TranscriptionStreamEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'completed'; readonly transcription: TranscriptionResponse };

export interface TranscriptionProvider {
  readonly kind: 'transcription';
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: TranscriptionCapabilities;
  transcribe(request: TranscriptionRequest): Promise<ProviderResult<TranscriptionResponse>>;
  stream?(request: TranscriptionRequest): AsyncIterable<ProviderResult<TranscriptionStreamEvent>>;
}

export interface EmbeddingRequest {
  readonly input: readonly string[];
}

export interface EmbeddingResponse {
  readonly vectors: readonly (readonly number[])[];
}

export interface EmbeddingProvider {
  readonly kind: 'embedding';
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: EmbeddingCapabilities;
  embed(request: EmbeddingRequest): Promise<ProviderResult<EmbeddingResponse>>;
}

export interface ProviderByKind {
  readonly 'language-model': LanguageModelProvider;
  readonly transcription: TranscriptionProvider;
  readonly embedding: EmbeddingProvider;
}

export type ProviderKind = keyof ProviderByKind;
export type RegisteredProvider = ProviderByKind[ProviderKind];

export interface ProviderCredential {
  readonly scheme: 'api-key' | 'bearer';
  readonly secret: string;
  readonly expiresAt?: string;
}

export interface CredentialProvider {
  getCredential(providerId: ProviderId): Promise<ProviderResult<ProviderCredential | null>>;
}

export type TelemetryOperation =
  | 'embedding.embed'
  | 'language-model.generate'
  | 'language-model.stream'
  | 'transcription.stream'
  | 'transcription.transcribe';

export interface TelemetryEvent {
  readonly providerId: ProviderId;
  readonly operation: TelemetryOperation;
  readonly outcome: 'error' | 'success';
  readonly durationMs: number;
  readonly errorCode?: ProviderErrorCode;
}

export interface TelemetrySink {
  record(event: TelemetryEvent): void | Promise<void>;
}
