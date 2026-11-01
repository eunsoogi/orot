import { nextVisitQuestionsCopy as copy } from './copy';
import type { NextVisitQuestionsController } from './controllerTypes';
import type { NextVisitEvidenceReference } from './types';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** Derives the visible page actions from the retained question phase. */
export function useNextVisitPrimaryAction<T extends NextVisitEvidenceReference>(
  controller: NextVisitQuestionsController<T>,
  canGenerate: boolean,
  hasSavedQuestions: boolean,
  onEdit: () => void,
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
  const actions = isReviewing
    ? [
        {
          id: 'save-questions',
          label: isSaving ? copy.review.saving : copy.review.save,
          testID: 'next-visit-review-save',
          busy: isSaving,
          systemImageName: 'checkmark',
          disabled: !controller.isReviewValid || isSaving,
          onPress: controller.save,
        },
        {
          id: 'cancel-question-review',
          label: copy.review.cancel,
          testID: 'next-visit-review-cancel',
          systemImageName: 'xmark',
          disabled: isSaving,
          onPress: controller.cancelReview,
        },
      ]
    : isGenerating
      ? [
          {
            id: 'cancel-generation',
            label: copy.generation.cancel,
            testID: 'next-visit-generation-cancel',
            systemImageName: 'xmark',
            onPress: controller.cancelGeneration,
          },
        ]
      : [
          {
            id: 'generate-questions',
            label: hasSavedQuestions ? copy.saved.generateAgain : generateLabel,
            testID: 'next-visit-generate',
            systemImageName: 'sparkles',
            disabled: !canGenerate,
            onPress: controller.generate,
          },
          ...(hasSavedQuestions
            ? [
                {
                  id: 'edit-questions',
                  label: copy.saved.edit,
                  testID: 'next-visit-saved-edit',
                  systemImageName: 'pencil',
                  onPress: onEdit,
                },
              ]
            : []),
        ];
  const hasSharedAction = useNavigationRouteActions(
    actions.map(action => ({ ...action, accessibilityLabel: action.label })),
  );
  return {
    isReviewing,
    isGenerating,
    isSaving,
    generateLabel,
    hasSharedAction,
  };
}
