import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import type { VisitQuestionRouteOperations } from './visitQuestionsRouteOperations';

export interface NextVisitQuestionsRouteProps extends VisitQuestionsRenderInput {
  /** Lets route tests control local service results without loading native storage. */
  readonly operations?: VisitQuestionRouteOperations;
}
