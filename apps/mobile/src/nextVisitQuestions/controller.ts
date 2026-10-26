import { useCallback, useEffect, useState } from 'react';
import { copyQuestions, isValidReview } from './questionReview';
import { useQuestionDraftControls } from './questionDraftControls';
import { useQuestionPersistence } from './useQuestionPersistence';
import { useCommittedContextKeys } from './useCommittedContextKeys';
import { useQuestionGeneration } from './useQuestionGeneration';
import type {
  NextVisitQuestionsController,
  NextVisitQuestionsControllerInputs,
} from './controllerTypes';
import type {
  EvidenceCaveat,
  NextVisitEvidenceReference,
  NextVisitQuestion,
  QuestionGenerationPhase,
  SavedQuestionsSnapshot,
} from './types';
export type { QuestionGenerationPhase } from './types';

/** Owns view transitions and rejects replies after visit/provider changes or newer user intent. */
export function useNextVisitQuestionsController<
  TReference extends NextVisitEvidenceReference,
>(
  inputs: NextVisitQuestionsControllerInputs<TReference>,
): NextVisitQuestionsController<TReference> {
  const { appointment, provider, onGenerate, onSaveReviewedQuestions } = inputs;
  const [phase, setPhase] = useState<QuestionGenerationPhase>('idle');
  const [draftQuestions, setDraftQuestions] = useState<
    readonly NextVisitQuestion<TReference>[]
  >([]);
  const [savedOverride, setSavedOverride] =
    useState<SavedQuestionsSnapshot<TReference> | null>(null);
  const [caveats, setCaveats] = useState<readonly EvidenceCaveat[]>([]);
  // Generated candidates are unpersisted; saved-list reviews stay clean until an actual edit.
  const [hasUnpersistedReview, setHasUnpersistedReview] = useState(false);
  const [sourceReference, setSourceReference] = useState<TReference | null>(
    null,
  );
  const appointmentKey =
    appointment.status === 'ready'
      ? // A rescheduled or edited appointment invalidates work even when its stable ID is unchanged.
        JSON.stringify(appointment.appointment)
      : appointment.status;
  const providerKey =
    provider.status === 'available' || provider.status === 'unavailable'
      ? JSON.stringify([
          provider.status,
          provider.selection.providerId,
          provider.selection.modelId,
        ])
      : provider.status;
  const currentContextKeys = useCommittedContextKeys(
    appointmentKey,
    providerKey,
  );
  const {
    save,
    saveMessage,
    clearMessage: clearSaveMessage,
    invalidate: invalidateSave,
  } = useQuestionPersistence({
    appointment,
    appointmentKey,
    contextKeys: currentContextKeys,
    draftQuestions,
    caveats,
    onSaveReviewedQuestions,
    setPhase,
    setDraftQuestions,
    setSavedOverride,
  });
  const {
    activity: generationActivity,
    preview: generationPreview,
    message: generationMessage,
    reset: resetGeneration,
    generate,
    cancelGeneration,
  } = useQuestionGeneration({
    appointment,
    appointmentKey,
    provider,
    providerKey,
    currentContextKeys,
    onGenerate,
    setPhase,
    setDraftQuestions,
    setHasUnpersistedReview,
    setCaveats,
    clearSaveMessage,
  });

  useEffect(() => {
    setPhase('idle');
    setDraftQuestions([]);
    setSavedOverride(null);
    setCaveats([]);
    setHasUnpersistedReview(false);
    resetGeneration();
    clearSaveMessage();
    setSourceReference(null);
  }, [appointmentKey, clearSaveMessage, resetGeneration]);

  const startReview = useCallback(
    (
      questions: readonly NextVisitQuestion<TReference>[],
      reviewCaveats: readonly EvidenceCaveat[] = [],
    ) => {
      // Opening a saved list supersedes pending generation and save replies.
      resetGeneration();
      invalidateSave();
      setDraftQuestions(copyQuestions(questions));
      setHasUnpersistedReview(false);
      setCaveats([...reviewCaveats]);
      setPhase('reviewing');
      clearSaveMessage();
    },
    [clearSaveMessage, invalidateSave, resetGeneration],
  );

  const cancelReview = useCallback(() => {
    invalidateSave();
    setDraftQuestions([]);
    setHasUnpersistedReview(false);
    setCaveats([]);
    setPhase('idle');
    clearSaveMessage();
  }, [clearSaveMessage, invalidateSave]);

  const markDraftEdited = useCallback(() => setHasUnpersistedReview(true), []);
  const { updateQuestion, moveQuestion, removeQuestion } =
    useQuestionDraftControls<TReference>(
      draftQuestions,
      setDraftQuestions,
      markDraftEdited,
    );

  const isReviewValid = isValidReview(draftQuestions);

  return {
    phase,
    draftQuestions,
    savedOverride,
    caveats,
    generationMessage,
    generationActivity,
    generationPreview,
    saveMessage,
    sourceReference,
    isReviewValid,
    hasUnsavedChanges:
      (phase === 'reviewing' || phase === 'saving') && hasUnpersistedReview,
    generate,
    cancelGeneration,
    startReview,
    cancelReview,
    updateQuestion,
    moveQuestion,
    removeQuestion,
    save,
    openSource: setSourceReference,
    closeSource: () => setSourceReference(null),
  };
}
