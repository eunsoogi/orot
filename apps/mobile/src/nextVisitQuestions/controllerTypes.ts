import type {
  EvidenceCaveat,
  NextVisitEvidenceReference,
  NextVisitQuestion,
  NextVisitQuestionUpdate,
  NextVisitQuestionsRouteState,
  NextVisitQuestionsScreenProps,
  QuestionGenerationPhase,
  SavedQuestionsSnapshot,
} from './types';

/** State and actions exposed to the focused next-visit screen. */
export interface NextVisitQuestionsController<
  TReference extends NextVisitEvidenceReference,
> {
  readonly phase: QuestionGenerationPhase;
  readonly draftQuestions: readonly NextVisitQuestion<TReference>[];
  readonly savedOverride: SavedQuestionsSnapshot<TReference> | null;
  readonly caveats: readonly EvidenceCaveat[];
  readonly generationMessage: string | null;
  readonly saveMessage: string | null;
  readonly sourceReference: TReference | null;
  readonly isReviewValid: boolean;
  readonly hasUnsavedChanges: NextVisitQuestionsRouteState['hasUnsavedChanges'];
  generate(): Promise<void>;
  cancelGeneration(): void;
  startReview(
    questions: readonly NextVisitQuestion<TReference>[],
    caveats?: readonly EvidenceCaveat[],
  ): void;
  cancelReview(): void;
  updateQuestion(
    index: number,
    update: NextVisitQuestionUpdate<TReference>,
  ): void;
  moveQuestion(index: number, offset: -1 | 1): void;
  removeQuestion(index: number): void;
  save(): Promise<void>;
  openSource(reference: TReference): void;
  closeSource(): void;
}

/** Excludes screen-only state so the controller depends on interaction inputs only. */
export type NextVisitQuestionsControllerInputs<
  TReference extends NextVisitEvidenceReference,
> = Pick<
  NextVisitQuestionsScreenProps<TReference>,
  'appointment' | 'provider' | 'onGenerate' | 'onSaveReviewedQuestions'
>;
