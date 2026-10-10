import { useNavigationPrimaryAction } from '../navigation/useNavigationPrimaryAction';
import { nextVisitQuestionsCopy as copy } from './copy';
import type { NextVisitQuestionsController } from './controllerTypes';
import type { NextVisitEvidenceReference } from './types';

/** Maps the current question phase to the route shell without duplicating its primary control. */
export function useNextVisitPrimaryAction<T extends NextVisitEvidenceReference>(
  controller: NextVisitQuestionsController<T>,
  canGenerate: boolean,
) {
  // Keep the draft visible while persistence is in flight so the user can still verify what is being retained.
  const isReviewing =
    controller.phase === 'reviewing' || controller.phase === 'saving';
  const isGenerating = controller.phase === 'generating';
  const isSaving = controller.phase === 'saving';
  const generateLabel =
    controller.phase === 'error'
      ? copy.generation.retry
      : controller.phase === 'saved'
        ? copy.saved.generateAgain
        : copy.generation.action;
  const primaryLabel = isReviewing
    ? isSaving
      ? copy.review.saving
      : copy.review.save
    : isGenerating
      ? copy.generation.cancel
      : generateLabel;
  // The app shell owns the same action beside Back/Home; isolated consumers retain their local controls.
  const hasSharedAction = useNavigationPrimaryAction({
    label: primaryLabel,
    accessibilityLabel: primaryLabel,
    testID: isReviewing
      ? 'next-visit-review-save'
      : isGenerating
        ? 'next-visit-generation-cancel'
        : 'next-visit-generate',
    disabled: isReviewing
      ? !controller.isReviewValid || isSaving
      : !isGenerating && !canGenerate,
    onPress: isReviewing
      ? controller.save
      : isGenerating
        ? controller.cancelGeneration
        : controller.generate,
  });

  return {
    isReviewing,
    isGenerating,
    isSaving,
    generateLabel,
    hasSharedAction,
  };
}
