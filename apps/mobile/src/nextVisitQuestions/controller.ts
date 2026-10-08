import { useCallback, useEffect, useRef, useState } from 'react';
import { nextVisitQuestionsCopy as copy } from './copy';
import { copyQuestions, isValidReview } from './questionReview';
import { useQuestionDraftControls } from './questionDraftControls';
import { useQuestionPersistence } from './useQuestionPersistence';
import { useCommittedContextKeys } from './useCommittedContextKeys';
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
  const [generationMessage, setGenerationMessage] = useState<string | null>(
    null,
  );
  const [sourceReference, setSourceReference] = useState<TReference | null>(
    null,
  );
  const activeGeneration = useRef<AbortController | null>(null);
  const appointmentKey =
    appointment.status === 'ready'
      ? appointment.appointment.id
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
  const previousProviderKey = useRef(providerKey);

  useEffect(() => {
    setPhase('idle');
    setDraftQuestions([]);
    setSavedOverride(null);
    setCaveats([]);
    setHasUnpersistedReview(false);
    setGenerationMessage(null);
    clearSaveMessage();
    setSourceReference(null);
    activeGeneration.current?.abort();
    activeGeneration.current = null;
    return () => {
      activeGeneration.current?.abort();
      activeGeneration.current = null;
    };
  }, [appointmentKey, clearSaveMessage]);

  useEffect(() => {
    if (previousProviderKey.current === providerKey) return;
    previousProviderKey.current = providerKey;
    const request = activeGeneration.current;
    if (!request) return;
    request.abort();
    activeGeneration.current = null;
    setPhase('idle');
    setGenerationMessage(copy.generation.providerChanged);
  }, [providerKey]);

  const generate = useCallback(async () => {
    if (appointment.status !== 'ready' || provider.status !== 'available') {
      return;
    }
    const requestAppointmentKey = appointmentKey;
    const requestProviderKey = providerKey;
    activeGeneration.current?.abort();
    const request = new AbortController();
    activeGeneration.current = request;
    setPhase('generating');
    setHasUnpersistedReview(false);
    setGenerationMessage(null);
    clearSaveMessage();
    setCaveats([]);
    try {
      const outcome = await onGenerate(
        appointment.appointment,
        provider.selection,
        request.signal,
      );
      if (request.signal.aborted || activeGeneration.current !== request)
        return;
      if (currentContextKeys.current.appointment !== requestAppointmentKey)
        return;
      if (currentContextKeys.current.provider !== requestProviderKey) {
        setPhase('idle');
        setGenerationMessage(copy.generation.providerChanged);
        return;
      }
      setCaveats(outcome.status === 'cancelled' ? [] : (outcome.caveats ?? []));
      if (outcome.status === 'ready') {
        if (outcome.questions.length < 3 || outcome.questions.length > 5) {
          setPhase('error');
          setGenerationMessage(copy.generation.invalidResult);
          return;
        }
        setDraftQuestions(copyQuestions(outcome.questions));
        setHasUnpersistedReview(true);
        setPhase('reviewing');
        return;
      }
      if (outcome.status === 'cancelled') {
        setPhase('idle');
        setGenerationMessage(copy.generation.cancelled);
        return;
      }
      setPhase('error');
      setGenerationMessage(outcome.message);
    } catch {
      if (request.signal.aborted || activeGeneration.current !== request)
        return;
      if (currentContextKeys.current.appointment !== requestAppointmentKey)
        return;
      if (currentContextKeys.current.provider !== requestProviderKey) {
        setPhase('idle');
        setGenerationMessage(copy.generation.providerChanged);
        return;
      }
      setPhase('error');
      setGenerationMessage(copy.generation.genericError);
    } finally {
      if (activeGeneration.current === request) activeGeneration.current = null;
    }
  }, [
    appointment,
    appointmentKey,
    clearSaveMessage,
    currentContextKeys,
    onGenerate,
    provider,
    providerKey,
  ]);

  const cancelGeneration = useCallback(() => {
    activeGeneration.current?.abort();
    activeGeneration.current = null;
    setPhase('idle');
    setHasUnpersistedReview(false);
    setGenerationMessage(copy.generation.cancelled);
  }, []);

  const startReview = useCallback(
    (
      questions: readonly NextVisitQuestion<TReference>[],
      reviewCaveats: readonly EvidenceCaveat[] = [],
    ) => {
      // Opening a saved list supersedes pending generation and save replies.
      activeGeneration.current?.abort();
      activeGeneration.current = null;
      invalidateSave();
      setDraftQuestions(copyQuestions(questions));
      setHasUnpersistedReview(false);
      setCaveats([...reviewCaveats]);
      setPhase('reviewing');
      setGenerationMessage(null);
      clearSaveMessage();
    },
    [clearSaveMessage, invalidateSave],
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
