import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { SymptomEntry } from '@orot/storage';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServices';
import type { SavedVisitQuestionsLoadState } from '../aiFeatures/integration/savedVisitQuestions';
import { openLocalSymptomJournal } from '../symptoms/localRepository';
import type { SymptomJournalRepository } from '../symptoms/localRepository';

export interface HomePreparationLoaders {
  readonly loadSymptoms?: () => Promise<SymptomJournalRepository>;
  readonly loadSavedVisitQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
}

/** Reads existing local summaries only; a Home visit never generates questions or writes health data. */
export function useHomePreparationData(
  appointmentId: string | undefined,
  {
    loadSymptoms = openLocalSymptomJournal,
    loadSavedVisitQuestions,
  }: HomePreparationLoaders,
) {
  const focused = useIsFocused();
  const [attempt, setAttempt] = useState(0);
  const [symptoms, setSymptoms] = useState<readonly SymptomEntry[]>([]);
  const [symptomUpdates, setSymptomUpdates] = useState<
    Record<string, string | null>
  >({});
  const [symptomState, setSymptomState] = useState<
    'loading' | 'ready' | 'failed'
  >('loading');
  const [questions, setQuestions] =
    useState<SavedVisitQuestionsLoadState | null>(null);
  const [questionState, setQuestionState] = useState<
    'loading' | 'ready' | 'failed'
  >('loading');
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!focused) return;
    let active = true;
    setSymptomState('loading');
    setSymptoms([]);
    loadSymptoms()
      .then(async repository => {
        const entries = await repository.list({ status: 'active' });
        const updates = await Promise.all(
          entries.map(
            async entry =>
              [
                entry.id,
                (await repository.getLastUpdatedAt?.(entry.id)) ?? null,
              ] as const,
          ),
        );
        return { entries, updates: Object.fromEntries(updates) };
      })
      .then(({ entries, updates }) => {
        if (!active) return;
        // Defensive filtering preserves the active-only contract for injected and legacy repositories.
        setSymptoms(entries.filter(entry => entry.status === 'active'));
        setSymptomUpdates(updates);
        setSymptomState('ready');
      })
      .catch(() => {
        if (active) setSymptomState('failed');
      });
    return () => {
      active = false;
    };
  }, [focused, loadSymptoms, attempt]);

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
    symptoms,
    symptomUpdates,
    symptomState,
    questions,
    questionState,
    retry,
  };
}
