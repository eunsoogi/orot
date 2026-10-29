import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import type { VisitQuestionRouteOperations } from './visitQuestionsRouteOperations';

export interface NextVisitQuestionsRouteProps extends VisitQuestionsRenderInput {
  /** Source/provider reentry retains one scope; a different Home entry or AI hub must not display its draft. */
  readonly sessionScope?: string;
  readonly sessionActive?: boolean;
  /** Lets route tests control local service results without loading native storage. */
  readonly operations?: VisitQuestionRouteOperations;
}
