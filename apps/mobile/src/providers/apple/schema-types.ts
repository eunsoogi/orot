import type { ToolCall, ToolCallResult } from '@orot/model-runtime';

export type AppleNativeSchema =
  | { readonly kind: 'string' | 'integer' | 'number' | 'boolean' }
  | {
      readonly kind: 'enum';
      readonly name: string;
      readonly description?: string;
      readonly values: readonly string[];
    }
  | {
      readonly kind: 'array';
      readonly item: AppleNativeSchema;
      readonly minimumElements?: number;
      readonly maximumElements?: number;
    }
  | {
      readonly kind: 'object';
      readonly name: string;
      readonly description?: string;
      readonly properties: readonly {
        readonly name: string;
        readonly schema: AppleNativeSchema;
        readonly optional: boolean;
        readonly description?: string;
      }[];
    }
  | {
      readonly kind: 'union';
      readonly name: string;
      readonly description?: string;
      readonly choices: readonly AppleNativeSchema[];
    };

export interface AppleNativeRequest {
  readonly instructions: string;
  readonly prompt: string;
  readonly mode: 'text' | 'structured' | 'tools' | 'mixed';
  readonly schema?: AppleNativeSchema;
  readonly toolNames: readonly string[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  // Native SDK tools are registered independently of the legacy Simulator mock response.
  readonly nativeTools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: AppleNativeSchema;
  }[];
  readonly nativeResponseSchema?: AppleNativeSchema;
  readonly nativeToolChoice: 'auto' | 'required';
  readonly nativeToolCalls: readonly ToolCall[];
  readonly nativeToolResults: readonly ToolCallResult[];
}
