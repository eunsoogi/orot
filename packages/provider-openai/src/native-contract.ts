export interface ChatGPTPlanModelDescriptor {
  readonly slug: string;
  readonly displayName: string;
}

export interface ChatGPTPlanMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export type ChatGPTPlanInputMessage =
  | ChatGPTPlanMessage
  | {
      readonly type: 'function_call';
      readonly callID: string;
      readonly name: string;
      readonly arguments: string;
    }
  | { readonly type: 'function_call_output'; readonly callID: string; readonly output: string }
  | { readonly type: 'continuation_item'; readonly json: string };

export interface ChatGPTPlanToolDefinition {
  readonly type: 'function';
  readonly name: string;
  readonly description?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly strict: false;
}

export interface ChatGPTPlanNativeToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ChatGPTPlanRequest {
  readonly model: string;
  readonly messages: readonly ChatGPTPlanInputMessage[];
  readonly tools?: readonly ChatGPTPlanToolDefinition[];
}

export interface ChatGPTPlanNativeError {
  readonly message?: string;
  readonly kind?:
    | 'authentication'
    | 'unsupported_capability'
    | 'unsupported_input'
    | 'usage_limit'
    | 'usage_unavailable'
    | 'invalid_request'
    | 'malformed_response'
    | 'incomplete'
    | 'interrupted'
    | 'transport'
    | 'provider';
  readonly httpStatusCode?: number;
  readonly bodyShape?: string;
  readonly code?: string;
  readonly parameter?: string;
  readonly requestID?: string;
  readonly reason?: string;
  readonly bodyTruncated?: boolean;
}

export type ChatGPTPlanNativeEvent =
  | { readonly requestId: string; readonly type: 'text_delta'; readonly text: string }
  | {
      readonly requestId: string;
      readonly type: 'tool_call';
      readonly toolCall: ChatGPTPlanNativeToolCall;
    }
  | {
      readonly requestId: string;
      readonly type: 'completed';
      readonly text: string;
      readonly toolCalls?: readonly ChatGPTPlanNativeToolCall[];
      readonly continuationItems?: readonly string[];
    }
  | { readonly requestId: string; readonly type: 'failed'; readonly error: ChatGPTPlanNativeError };

export interface ChatGPTPlanNativeBridge {
  listModels(issuedClientID: string): Promise<readonly ChatGPTPlanModelDescriptor[]>;
  subscribe(listener: (event: ChatGPTPlanNativeEvent) => void): () => void;
  startResponse(
    requestId: string,
    issuedClientID: string,
    request: ChatGPTPlanRequest,
  ): Promise<void>;
  cancelResponse(requestId: string): void;
}
