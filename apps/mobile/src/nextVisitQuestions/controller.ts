import { useCallback, useEffect, useRef, useState } from 'react';
import { nextVisitQuestionsCopy as copy } from './copy';
import { copyQuestions, isValidReview } from './questionReview';
import { useQuestionDraftControls } from './questionDraftControls';
import { useCommittedContextKeys } from './useCommittedContextKeys';
import type {
  EvidenceCaveat,
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionUpdate,
  NextVisitQuestionsScreenProps,
} from './types';

export type QuestionGenerationPhase =
  'idle' | 'generating' | 'reviewing' | 'saving' | 'saved' | 'error';

export interface NextVisitQuestionsController<
  TReference extends NextVisitEvidenceReference,
> {
  readonly phase: QuestionGenerationPhase;
  readonly draftQuestions: readonly NextVisitQuestion<TReference>[];
  readonly savedOverride: readonly NextVisitQuestion<TReference>[] | null;
  readonly caveats: readonly EvidenceCaveat[];
  readonly generationMessage: string | null;
  readonly saveMessage: string | null;
  readonly sourceReference: TReference | null;
  readonly isReviewValid: boolean;
  generate(): Promise<void>;
  cancelGeneration(): void;
  startReview(questions: readonly NextVisitQuestion<TReference>[]): void;
  cancelReview(): void;
  updateQuestion(index: number, update: NextVisitQuestionUpdate<TReference>): void;
  moveQuestion(index: number, offset: -1 | 1): void;
  removeQuestion(index: number): void;
  save(): Promise<void>;
  openSource(reference: TReference): void;
  closeSource(): void;
}

type Inputs<TReference extends NextVisitEvidenceReference> = Pick<
  NextVisitQuestionsScreenProps<TReference>,
  'appointment' | 'provider' | 'onGenerate' | 'onSaveReviewedQuestions'
>;

/** Owns view transitions and rejects async replies after their appointment or provider context changes. */
export function useNextVisitQuestionsController<
  TReference extends NextVisitEvidenceReference,
>(inputs: Inputs<TReference>): NextVisitQuestionsController<TReference> {
  const { appointment, provider, onGenerate, onSaveReviewedQuestions } = inputs;
  const [phase, setPhase] = useState<QuestionGenerationPhase>('idle');
  const [draftQuestions, setDraftQuestions] = useState<
    readonly NextVisitQuestion<TReference>[]
  >([]);
  const [savedOverride, setSavedOverride] = useState<
    readonly NextVisitQuestion<TReference>[] | null
  >(null);
  const [caveats, setCaveats] = useState<readonly EvidenceCaveat[]>([]);
  const [generationMessage, setGenerationMessage] = useState<string | null>(
    null,
  );
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
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
  const previousProviderKey = useRef(providerKey);

  useEffect(() => {
    setPhase('idle');
    setDraftQuestions([]);
    setSavedOverride(null);
    setCaveats([]);
    setGenerationMessage(null);
    setSaveMessage(null);
    setSourceReference(null);
    activeGeneration.current?.abort();
    activeGeneration.current = null;
    return () => activeGeneration.current?.abort();
  }, [appointmentKey]);

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
    setGenerationMessage(null);
    setSaveMessage(null);
    setCaveats([]);
    try {
      const outcome = await onGenerate(
        appointment.appointment,
        provider.selection,
        request.signal,
      );
      if (request.signal.aborted) return;
      if (currentContextKeys.current.appointment !== requestAppointmentKey) return;
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
      if (request.signal.aborted) return;
      if (currentContextKeys.current.appointment !== requestAppointmentKey) return;
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
  }, [appointment, appointmentKey, onGenerate, provider, providerKey]);

  const cancelGeneration = useCallback(() => {
    activeGeneration.current?.abort();
    activeGeneration.current = null;
    setPhase('idle');
    setGenerationMessage(copy.generation.cancelled);
  }, []);

  const startReview = useCallback(
    (questions: readonly NextVisitQuestion<TReference>[]) => {
      setDraftQuestions(copyQuestions(questions));
      setPhase('reviewing');
      setGenerationMessage(null);
      setSaveMessage(null);
    },
    [],
  );

  const cancelReview = useCallback(() => {
    setDraftQuestions([]);
    setPhase('idle');
    setSaveMessage(null);
  }, []);

  const { updateQuestion, moveQuestion, removeQuestion } =
    useQuestionDraftControls<TReference>(setDraftQuestions);

  const isReviewValid = isValidReview(draftQuestions);

  const save = useCallback(async () => {
    if (appointment.status !== 'ready' || !isValidReview(draftQuestions)) {
      setSaveMessage(copy.review.empty);
      return;
    }
    const saveAppointmentKey = appointmentKey;
    setPhase('saving');
    setSaveMessage(null);
    try {
      const result = await onSaveReviewedQuestions(
        appointment.appointment,
        copyQuestions(draftQuestions),
      );
      // Persistence is scoped to the captured visit; its late reply must not replace another visit's view.
      if (currentContextKeys.current.appointment !== saveAppointmentKey) return;
      setSavedOverride(copyQuestions(result.questions));
      setDraftQuestions([]);
      setPhase('saved');
      setSaveMessage(
        result.memoryStatus === 'retry_required'
          ? copy.review.memoryRetry
          : copy.review.saved,
      );
    } catch {
      if (currentContextKeys.current.appointment !== saveAppointmentKey) return;
      setPhase('reviewing');
      setSaveMessage(copy.review.saveError);
    }
  }, [appointment, appointmentKey, draftQuestions, onSaveReviewedQuestions]);

  return {
    phase,
    draftQuestions,
    savedOverride,
    caveats,
    generationMessage,
    saveMessage,
    sourceReference,
    isReviewValid,
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
