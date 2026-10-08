import { useLayoutEffect, useRef } from 'react';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionsRouteState,
  QuestionGenerationPhase,
} from './types';

interface RouteStatePublisherInputs<
  TReference extends NextVisitEvidenceReference,
> {
  readonly appointmentId: string | null;
  readonly phase: QuestionGenerationPhase;
  readonly draftQuestions: readonly NextVisitQuestion<TReference>[];
  readonly hasUnsavedChanges: boolean;
  readonly onRouteStateChange?: (state: NextVisitQuestionsRouteState) => void;
}

interface PublishedState<TReference extends NextVisitEvidenceReference> {
  readonly appointmentId: string | null;
  readonly phase: QuestionGenerationPhase;
  readonly draftQuestions: readonly NextVisitQuestion<TReference>[];
  readonly hasUnsavedChanges: boolean;
}

/** Publishes committed review ownership so newly attached route guards see the current state. */
export function useRouteStatePublisher<
  TReference extends NextVisitEvidenceReference,
>(inputs: RouteStatePublisherInputs<TReference>): void {
  const {
    appointmentId,
    phase,
    draftQuestions,
    hasUnsavedChanges,
    onRouteStateChange,
  } = inputs;
  const revision = useRef(0);
  const publishedState = useRef<PublishedState<TReference> | null>(null);

  useLayoutEffect(() => {
    const previous = publishedState.current;
    // A callback replacement alone republishes without advancing the revision.
    if (
      !previous ||
      previous.appointmentId !== appointmentId ||
      previous.phase !== phase ||
      previous.draftQuestions !== draftQuestions ||
      previous.hasUnsavedChanges !== hasUnsavedChanges
    ) {
      revision.current += 1;
      publishedState.current = {
        appointmentId,
        phase,
        draftQuestions,
        hasUnsavedChanges,
      };
    }
    onRouteStateChange?.({
      hasUnsavedChanges,
      isSaving: phase === 'saving',
      revision: revision.current,
    });
  }, [
    appointmentId,
    draftQuestions,
    hasUnsavedChanges,
    onRouteStateChange,
    phase,
  ]);
}
