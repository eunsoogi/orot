import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { nextVisitQuestionsCopy as copy } from './copy';
import { copyQuestions } from './questionReview';
import { useQuestionGenerationActivity } from './useQuestionGenerationActivity';
import type {
  AppointmentViewState,
  EvidenceCaveat,
  NextVisitEvidenceReference,
  NextVisitQuestion,
  ProviderViewState,
  QuestionGenerationPhase,
} from './types';
import type { CommittedContextKeys } from './useCommittedContextKeys';
import type { NextVisitQuestionsControllerInputs } from './controllerTypes';

type ContextKeysRef = { readonly current: CommittedContextKeys };

/** Owns one generation request so preview callbacks share its cancellation and stale-result guard. */
export function useQuestionGeneration<
  TReference extends NextVisitEvidenceReference,
>({
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
}: {
  readonly appointment: AppointmentViewState;
  readonly appointmentKey: string;
  readonly provider: ProviderViewState;
  readonly providerKey: string;
  readonly currentContextKeys: ContextKeysRef;
  readonly onGenerate: NextVisitQuestionsControllerInputs<TReference>['onGenerate'];
  readonly setPhase: Dispatch<SetStateAction<QuestionGenerationPhase>>;
  readonly setDraftQuestions: Dispatch<
    SetStateAction<readonly NextVisitQuestion<TReference>[]>
  >;
  readonly setHasUnpersistedReview: Dispatch<SetStateAction<boolean>>;
  readonly setCaveats: Dispatch<SetStateAction<readonly EvidenceCaveat[]>>;
  readonly clearSaveMessage: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const activeGeneration = useRef<AbortController | null>(null);
  const previousProviderKey = useRef(providerKey);
  const {
    activity: currentActivity,
    preview,
    begin: beginActivity,
    clear: clearActivity,
    finish: finishActivity,
    createObserver,
  } = useQuestionGenerationActivity();

  const reset = useCallback(() => {
    activeGeneration.current?.abort();
    activeGeneration.current = null;
    clearActivity();
    setMessage(null);
  }, [clearActivity]);

  useEffect(
    () => () => {
      activeGeneration.current?.abort();
      activeGeneration.current = null;
    },
    [],
  );

  useEffect(() => {
    if (previousProviderKey.current === providerKey) return;
    previousProviderKey.current = providerKey;
    if (!activeGeneration.current) return;
    activeGeneration.current.abort();
    activeGeneration.current = null;
    clearActivity();
    setPhase('idle');
    setMessage(copy.generation.providerChanged);
  }, [clearActivity, providerKey, setPhase]);

  const generate = useCallback(async () => {
    if (appointment.status !== 'ready' || provider.status !== 'available')
      return;
    const requestAppointmentKey = appointmentKey;
    const requestProviderKey = providerKey;
    activeGeneration.current?.abort();
    const request = new AbortController();
    activeGeneration.current = request;
    setPhase('generating');
    setHasUnpersistedReview(false);
    setMessage(null);
    clearSaveMessage();
    setCaveats([]);
    beginActivity(copy.generation.loading);
    let acceptingEvents = true;
    const isCurrentRun = () =>
      acceptingEvents &&
      !request.signal.aborted &&
      activeGeneration.current === request;
    try {
      const outcome = await onGenerate(
        appointment.appointment,
        provider.selection,
        request.signal,
        createObserver(isCurrentRun),
      );
      if (request.signal.aborted || activeGeneration.current !== request)
        return;
      acceptingEvents = false;
      finishActivity();
      if (currentContextKeys.current.appointment !== requestAppointmentKey)
        return;
      if (currentContextKeys.current.provider !== requestProviderKey) {
        setPhase('idle');
        setMessage(copy.generation.providerChanged);
        return;
      }
      setCaveats(outcome.status === 'cancelled' ? [] : (outcome.caveats ?? []));
      if (outcome.status === 'ready') {
        if (outcome.questions.length < 3 || outcome.questions.length > 5) {
          setPhase('error');
          setMessage(copy.generation.invalidResult);
          return;
        }
        clearActivity();
        setDraftQuestions(copyQuestions(outcome.questions));
        setHasUnpersistedReview(true);
        setPhase('reviewing');
        return;
      }
      if (outcome.status === 'cancelled') {
        setPhase('idle');
        setMessage(copy.generation.cancelled);
        return;
      }
      setPhase('error');
      setMessage(outcome.message);
    } catch {
      acceptingEvents = false;
      if (request.signal.aborted || activeGeneration.current !== request)
        return;
      if (currentContextKeys.current.appointment !== requestAppointmentKey)
        return;
      if (currentContextKeys.current.provider !== requestProviderKey) {
        setPhase('idle');
        setMessage(copy.generation.providerChanged);
        return;
      }
      finishActivity();
      setPhase('error');
      setMessage(copy.generation.genericError);
    } finally {
      if (activeGeneration.current === request) activeGeneration.current = null;
    }
  }, [
    beginActivity,
    clearActivity,
    finishActivity,
    createObserver,
    appointment,
    appointmentKey,
    clearSaveMessage,
    currentContextKeys,
    onGenerate,
    provider,
    providerKey,
    setCaveats,
    setDraftQuestions,
    setHasUnpersistedReview,
    setPhase,
  ]);

  const cancelGeneration = useCallback(() => {
    activeGeneration.current?.abort();
    activeGeneration.current = null;
    finishActivity();
    setPhase('idle');
    setHasUnpersistedReview(false);
    setMessage(copy.generation.cancelled);
  }, [finishActivity, setHasUnpersistedReview, setPhase]);

  return {
    activity: currentActivity,
    preview,
    message,
    reset,
    generate,
    cancelGeneration,
  };
}
