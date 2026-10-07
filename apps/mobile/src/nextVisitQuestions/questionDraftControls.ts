import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionUpdate,
} from './types';

type DraftQuestionSetter<TReference extends NextVisitEvidenceReference> =
  Dispatch<SetStateAction<readonly NextVisitQuestion<TReference>[]>>;

/** Keeps edits, priority changes, ordering, and removal immutable across review renders. */
export function useQuestionDraftControls<
  TReference extends NextVisitEvidenceReference,
>(setDraftQuestions: DraftQuestionSetter<TReference>) {
  const updateQuestion = useCallback(
    (index: number, update: NextVisitQuestionUpdate<TReference>) => {
      setDraftQuestions(current =>
        current.map((question, itemIndex) =>
          itemIndex === index ? { ...question, ...update } : question,
        ),
      );
    },
    [setDraftQuestions],
  );

  const moveQuestion = useCallback(
    (index: number, offset: -1 | 1) => {
      setDraftQuestions(current => {
        const target = index + offset;
        if (target < 0 || target >= current.length) return current;
        const moved = [...current];
        [moved[index], moved[target]] = [moved[target]!, moved[index]!];
        return moved;
      });
    },
    [setDraftQuestions],
  );

  const removeQuestion = useCallback(
    (index: number) => {
      setDraftQuestions(current =>
        current.filter((_, itemIndex) => itemIndex !== index),
      );
    },
    [setDraftQuestions],
  );

  return { updateQuestion, moveQuestion, removeQuestion };
}
