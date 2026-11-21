import type { ProviderSelectionScreenNavigationState } from './providerSelectionNavigationState';
import type {
  ChatGPTAccountSetup,
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionPresentation,
  ProviderSelectionRequirements,
  ProviderSelectionStore,
} from './types';

/** Route-owned selection inputs shared by the model settings screen. */
export interface ProviderSelectionScreenProps {
  readonly presentation?: ProviderSelectionPresentation;
  readonly screenTitle?: string;
  readonly screenIntroduction?: string;
  readonly navigationRouteKey?: string;
  readonly options: readonly ProviderSelectionOption[];
  readonly requirements: ProviderSelectionRequirements;
  readonly selectionStore: ProviderSelectionStore;
  readonly chatGPTSetup?: ChatGPTAccountSetup;
  readonly onBack?: () => void;
  readonly onSelectionCommitted?: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
  readonly onNavigationStateChange?: (
    state: ProviderSelectionScreenNavigationState,
  ) => void;
}
