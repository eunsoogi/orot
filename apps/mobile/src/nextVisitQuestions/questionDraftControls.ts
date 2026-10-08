import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionUpdate,
} from './types';

type DraftQuestionSetter<TReference extends NextVisitEvidenceReference> =
  Dispatch<SetStateAction<readonly NextVisitQuestion<TReference>[]>>;

/** Keeps review edits immutable and marks only valid changes as unpersisted. */
export function useQuestionDraftControls<
  TReference extends NextVisitEvidenceReference,
>(
  draftQuestions: readonly NextVisitQuestion<TReference>[],
  setDraftQuestions: DraftQuestionSetter<TReference>,
  onDraftEdited: () => void,
) {
  const updateQuestion = useCallback(
    (index: number, update: NextVisitQuestionUpdate<TReference>) => {
      const original = draftQuestions[index];
      if (
        !original ||
        Object.entries(update).every(([key, value]) =>
          Object.is(original[key as keyof typeof original], value),
        )
      ) {
        return;
      }
      setDraftQuestions(current =>
        current.map((question, itemIndex) =>
          itemIndex === index ? { ...question, ...update } : question,
        ),
      );
      onDraftEdited();
    },
    [draftQuestions, onDraftEdited, setDraftQuestions],
  );

  const moveQuestion = useCallback(
    (index: number, offset: -1 | 1) => {
      const target = index + offset;
      if (
        index < 0 ||
        index >= draftQuestions.length ||
        target < 0 ||
        target >= draftQuestions.length
      ) {
        return;
      }
      setDraftQuestions(current => {
        const moved = [...current];
        [moved[index], moved[target]] = [moved[target]!, moved[index]!];
        return moved;
      });
      onDraftEdited();
    },
    [draftQuestions.length, onDraftEdited, setDraftQuestions],
  );

  const removeQuestion = useCallback(
    (index: number) => {
      if (index < 0 || index >= draftQuestions.length) return;
      setDraftQuestions(current =>
        current.filter((_, itemIndex) => itemIndex !== index),
      );
      onDraftEdited();
    },
    [draftQuestions.length, onDraftEdited, setDraftQuestions],
  );

  return { updateQuestion, moveQuestion, removeQuestion };
}
