import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServices';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';

export interface HomePreparationLoaders {
  readonly loadSavedVisitQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
}

/** Reads existing local summaries only; a Home visit never generates questions or writes health data. */
export function useHomePreparationData(
  appointmentId: string | undefined,
  { loadSavedVisitQuestions }: HomePreparationLoaders,
) {
  const focused = useIsFocused();
  const [attempt, setAttempt] = useState(0);
  const [questions, setQuestions] =
    useState<SavedVisitQuestionsLoadState | null>(null);
  const [questionState, setQuestionState] = useState<
    'loading' | 'ready' | 'failed'
  >('loading');
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!focused) return;
    let active = true;
    setQuestions(null);
    setQuestionState(appointmentId ? 'loading' : 'ready');
    if (appointmentId) {
      if (!loadSavedVisitQuestions) setQuestionState('failed');
      else
        loadSavedVisitQuestions(appointmentId)
          .then(result => {
            if (!active) return;
            // Reads may overlap a visit change. Never display questions attributed to another appointment.
            if (
              result.appointmentId !== appointmentId ||
              result.status === 'error'
            ) {
              setQuestionState('failed');
              return;
            }
            setQuestions(result);
            setQuestionState('ready');
          })
          .catch(() => {
            if (active) setQuestionState('failed');
          });
    }
    return () => {
      active = false;
    };
  }, [focused, appointmentId, loadSavedVisitQuestions, attempt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (focused && state === 'active') retry();
    });
    return () => subscription.remove();
  }, [focused, retry]);

  return {
    questions,
    questionState,
    retry,
  };
}
