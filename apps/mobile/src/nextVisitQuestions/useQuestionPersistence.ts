import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { nextVisitQuestionsCopy as copy } from './copy';
import { copyQuestions, isValidReview } from './questionReview';
import type { CommittedContextKeys } from './useCommittedContextKeys';
import type {
  AppointmentViewState,
  EvidenceCaveat,
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionsScreenProps,
  QuestionGenerationPhase,
  SavedQuestionsSnapshot,
} from './types';

interface QuestionPersistenceInputs<
  TReference extends NextVisitEvidenceReference,
> {
  readonly appointment: AppointmentViewState;
  readonly appointmentKey: string;
  readonly contextKeys: MutableRefObject<CommittedContextKeys>;
  readonly draftQuestions: readonly NextVisitQuestion<TReference>[];
  readonly caveats: readonly EvidenceCaveat[];
  readonly onSaveReviewedQuestions: NextVisitQuestionsScreenProps<TReference>['onSaveReviewedQuestions'];
  readonly setPhase: Dispatch<SetStateAction<QuestionGenerationPhase>>;
  readonly setDraftQuestions: Dispatch<
    SetStateAction<readonly NextVisitQuestion<TReference>[]>
  >;
  readonly setSavedOverride: Dispatch<
    SetStateAction<SavedQuestionsSnapshot<TReference> | null>
  >;
}

/** Applies a save reply only while the visit and review operation still own the screen. */
export function useQuestionPersistence<
  TReference extends NextVisitEvidenceReference,
>(inputs: QuestionPersistenceInputs<TReference>) {
  const {
    appointment,
    appointmentKey,
    contextKeys,
    draftQuestions,
    caveats,
    onSaveReviewedQuestions,
    setPhase,
    setDraftQuestions,
    setSavedOverride,
  } = inputs;
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const operationId = useRef(0);
  const invalidate = useCallback(() => {
    operationId.current += 1;
  }, []);
  const clearMessage = useCallback(() => setSaveMessage(null), []);

  useEffect(() => {
    return invalidate;
  }, [appointmentKey, invalidate]);

  const save = useCallback(async () => {
    if (appointment.status !== 'ready' || !isValidReview(draftQuestions)) {
      setSaveMessage(copy.review.empty);
      return;
    }
    const saveAppointmentKey = appointmentKey;
    const saveVisitRevision = contextKeys.current.appointmentRevision;
    const saveOperationId = ++operationId.current;
    const isCurrentSave = () =>
      operationId.current === saveOperationId &&
      contextKeys.current.appointment === saveAppointmentKey &&
      contextKeys.current.appointmentRevision === saveVisitRevision;

    setPhase('saving');
    setSaveMessage(null);
    try {
      const result = await onSaveReviewedQuestions(
        appointment.appointment,
        copyQuestions(draftQuestions),
        [...caveats],
      );
      if (!isCurrentSave()) return;
      setSavedOverride({
        appointmentId: saveAppointmentKey,
        questions: copyQuestions(result.questions),
        caveats: [...result.caveats],
      });
      setDraftQuestions([]);
      setPhase('saved');
      setSaveMessage(
        result.memoryStatus === 'retry_required'
          ? copy.review.memoryRetry
          : copy.review.saved,
      );
    } catch {
      if (!isCurrentSave()) return;
      setPhase('reviewing');
      setSaveMessage(copy.review.saveError);
    }
  }, [
    appointment,
    appointmentKey,
    caveats,
    contextKeys,
    draftQuestions,
    onSaveReviewedQuestions,
    setDraftQuestions,
    setPhase,
    setSavedOverride,
  ]);

  return { save, saveMessage, clearMessage, invalidate };
}
