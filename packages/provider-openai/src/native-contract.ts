export interface ChatGPTPlanModelDescriptor {
  readonly slug: string;
  readonly displayName: string;
}

export interface ChatGPTPlanMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatGPTPlanRequest {
  readonly model: string;
  readonly messages: readonly ChatGPTPlanMessage[];
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
  | { readonly requestId: string; readonly type: 'completed'; readonly text: string }
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
