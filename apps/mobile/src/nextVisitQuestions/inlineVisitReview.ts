import { createQuestionIdentity } from './questionIdentity';
import { copyQuestions, isValidReview } from './questionReview';
import type {
  EvidenceCaveat,
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionUpdate,
} from './types';

export interface InlineVisitReview<T extends NextVisitEvidenceReference> {
  readonly ownerKey: string;
  readonly items: readonly {
    readonly question: NextVisitQuestion<T>;
    readonly origin: 'saved' | 'candidate';
    readonly selected: boolean;
  }[];
  readonly expectedSavedQuestions: readonly {
    readonly id: string;
    readonly revision: string;
  }[];
  readonly caveats: readonly EvidenceCaveat[];
}

export interface InlineVisitSelection<T extends NextVisitEvidenceReference> {
  readonly questions: readonly NextVisitQuestion<T>[];
  readonly expectedSavedQuestions: InlineVisitReview<T>['expectedSavedQuestions'];
  readonly caveats: readonly EvidenceCaveat[];
}

/** Create one operation-owned review; saved rows remain selected until explicitly changed. */
export function createInlineVisitReview<T extends NextVisitEvidenceReference>(
  ownerKey: string,
  saved: readonly NextVisitQuestion<T>[],
  candidates: readonly NextVisitQuestion<T>[],
  caveats: readonly EvidenceCaveat[],
  createId: () => string = createQuestionIdentity,
): InlineVisitReview<T> {
  if (!ownerKey) throw new Error('A conversation review owner is required.');
  const expectedSavedQuestions = saved.map(question => {
    if (!question.identity?.id || !question.identity.expectedRevision)
      throw new Error(
        'The saved question list must be reloaded before review.',
      );
    return {
      id: question.identity.id,
      revision: question.identity.expectedRevision,
    };
  });
  const items = [
    ...copyQuestions(saved).map(question => ({
      question,
      origin: 'saved' as const,
      selected: true,
    })),
    ...copyQuestions(candidates).map(question => ({
      question: { ...question, identity: { id: createId() } },
      origin: 'candidate' as const,
      selected: false,
    })),
  ];
  const ids = items.map(item => item.question.identity!.id);
  if (
    ids.some(id => !id.trim() || id !== id.trim()) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Question identities must be unique.');
  return { ownerKey, items, expectedSavedQuestions, caveats: [...caveats] };
}

export function inlineReviewToggle<T extends NextVisitEvidenceReference>(
  state: InlineVisitReview<T>,
  id: string,
): InlineVisitReview<T> {
  return {
    ...state,
    items: state.items.map(item =>
      item.question.identity?.id === id
        ? { ...item, selected: !item.selected }
        : item,
    ),
  };
}

export function inlineReviewUpdate<T extends NextVisitEvidenceReference>(
  state: InlineVisitReview<T>,
  id: string,
  update: NextVisitQuestionUpdate<T>,
): InlineVisitReview<T> {
  const { questionText, rationale, priority } = update;
  return {
    ...state,
    items: state.items.map(item =>
      item.question.identity?.id === id
        ? {
            ...item,
            question: {
              ...item.question,
              ...(questionText !== undefined ? { questionText } : {}),
              ...(rationale !== undefined ? { rationale } : {}),
              ...(priority !== undefined ? { priority } : {}),
            },
          }
        : item,
    ),
  };
}

export function inlineReviewMove<T extends NextVisitEvidenceReference>(
  state: InlineVisitReview<T>,
  id: string,
  offset: -1 | 1,
): InlineVisitReview<T> {
  const index = state.items.findIndex(
    item => item.question.identity?.id === id,
  );
  const target = index + offset;
  if (index < 0 || target < 0 || target >= state.items.length) return state;
  const items = [...state.items];
  [items[index], items[target]] = [items[target]!, items[index]!];
  return { ...state, items };
}

/** Removing a saved row is explicit; an unselected saved row can still be restored before saving. */
export function inlineReviewRemove<T extends NextVisitEvidenceReference>(
  state: InlineVisitReview<T>,
  id: string,
): InlineVisitReview<T> {
  return {
    ...state,
    items: state.items.flatMap(item =>
      item.question.identity?.id !== id
        ? [item]
        : item.origin === 'saved'
          ? [{ ...item, selected: false }]
          : [],
    ),
  };
}

/** The empty selection never calls persistence and cannot be presented as saved. */
export function inlineReviewSelection<T extends NextVisitEvidenceReference>(
  state: InlineVisitReview<T>,
): InlineVisitSelection<T> | null {
  const questions = state.items
    .filter(item => item.selected)
    .map(item => item.question);
  return isValidReview(questions)
    ? {
        questions: copyQuestions(questions),
        expectedSavedQuestions: state.expectedSavedQuestions,
        caveats: state.caveats,
      }
    : null;
}

/** A successful save replaces only the selected rows; unchecked new candidates remain editable. */
export function inlineReviewCommitted<T extends NextVisitEvidenceReference>(
  state: InlineVisitReview<T>,
  ownerKey: string,
  saved: readonly NextVisitQuestion<T>[],
): InlineVisitReview<T> {
  if (state.ownerKey !== ownerKey) return state;
  const selected = state.items.filter(item => item.selected);
  if (
    selected.length !== saved.length ||
    saved.some(
      (question, index) =>
        question.identity?.id !== selected[index]?.question.identity?.id ||
        !question.identity?.expectedRevision,
    )
  )
    throw new Error('The saved question response does not match this review.');
  let index = 0;
  const items = state.items.flatMap(item => {
    if (item.selected)
      return [
        { question: saved[index++]!, origin: 'saved' as const, selected: true },
      ];
    return item.origin === 'candidate' ? [item] : [];
  });
  return {
    ...state,
    items,
    expectedSavedQuestions: saved.map(question => ({
      id: question.identity!.id,
      revision: question.identity!.expectedRevision!,
    })),
  };
}
