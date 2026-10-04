export type AppleNativeSchema =
  | { readonly kind: 'string' | 'integer' | 'number' | 'boolean' }
  | {
      readonly kind: 'enum';
      readonly name: string;
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
}
