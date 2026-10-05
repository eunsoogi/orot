import type {
  LanguageModelProvider,
  ProviderInputType,
} from '@orot/model-runtime';
import type { OpenAIAccountSummary } from '../openai';

export interface ProviderSelection {
  readonly providerId: string;
  readonly modelId: string;
}

/** Remote candidates disclose only explicitly selected context after a separate confirmation. */
export type ProviderPrivacyBoundary = 'on-device' | 'selected-context-remote';

export type ProviderAvailability =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly message: string };

export interface ProviderSelectionOption {
  readonly provider: LanguageModelProvider;
  readonly modelId: string;
  readonly displayName: string;
  readonly privacyBoundary: ProviderPrivacyBoundary;
  readonly availability: ProviderAvailability;
}

export interface ProviderSelectionRequirements {
  readonly inputTypes: readonly ProviderInputType[];
  readonly streaming?: boolean;
  readonly structuredOutput?: boolean;
  readonly toolCalling?: boolean;
}

export interface ProviderSelectionStore {
  load(): Promise<ProviderSelection | null>;
  save(selection: ProviderSelection): Promise<void>;
  clear(): Promise<void>;
}

export interface ChatGPTAccountSetup {
  readonly accounts: readonly OpenAIAccountSummary[];
  readonly selectedAccountID: string | null;
  readonly statusMessage: string;
  readonly statusIsError: boolean;
  readonly actionTitle: string;
  readonly busy: boolean;
  readonly signingIn: boolean;
  readonly actionDisabled: boolean;
  readonly onAccountSelected: (issuedClientID: string) => void;
  readonly onAction: () => void;
  readonly onCancelSignIn: () => void;
}

export type ProviderSelectionResolution =
  | { readonly ok: true; readonly provider: LanguageModelProvider }
  | {
      readonly ok: false;
      readonly reason:
        | 'selection-required'
        | 'selection-unavailable'
        | 'provider-unavailable'
        | 'missing-capability';
      readonly message?: string;
    };
