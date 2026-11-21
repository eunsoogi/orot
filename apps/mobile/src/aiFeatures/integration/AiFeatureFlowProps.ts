import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import type { AiFeatureRouteName } from './aiFeatureNavigation';
import type {
  AiFeatureServiceDependencies,
  AiFeatureServices,
} from './featureServices';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../../providers/selection';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { ReactElement } from 'react';
export interface AiFeatureFlowProps {
  readonly canonicalConversationRoot?: boolean;
  readonly isEntryCurrent?: () => boolean;
  /** Route ownership excludes app focus, so suspension cannot empty retained rows. */
  readonly isRouteCurrent?: () => boolean;
  readonly navigation: NavigationRouteActions<AiFeatureRouteName>;
  readonly consent: ExecutionConsentPort;
  readonly services: AiFeatureServices;
  readonly renderVisitQuestions?: (
    input: VisitQuestionsRenderInput,
  ) => ReactElement;
  readonly onOpenArticle: (
    publication: ExternalMedicalPublication,
  ) => void | Promise<void>;
  /** Lets the home shortcut update its provider summary after selection is committed. */
  readonly onProviderSelectionCommitted?: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
}
