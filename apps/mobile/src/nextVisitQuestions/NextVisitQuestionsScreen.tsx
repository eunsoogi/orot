import { useNextVisitQuestionsController } from './controller';
import { NextVisitQuestionsScreenView } from './NextVisitQuestionsScreenView';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestionsScreenProps,
} from './types';

/** Standalone consumers own their controller; app routes inject a retained controller. */
export function NextVisitQuestionsScreen<T extends NextVisitEvidenceReference>(
  props: NextVisitQuestionsScreenProps<T> & {
    readonly navigationRouteKey?: string;
  },
) {
  const controller = useNextVisitQuestionsController(props);
  return <NextVisitQuestionsScreenView {...props} controller={controller} />;
}
