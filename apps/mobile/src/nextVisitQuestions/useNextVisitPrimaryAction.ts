import { nextVisitQuestionsCopy as copy } from './copy';
import type { NextVisitQuestionsController } from './controllerTypes';
import type { NextVisitEvidenceReference } from './types';

/** Derives the visible page actions from the retained question phase. */
export function useNextVisitPrimaryAction<T extends NextVisitEvidenceReference>(
  controller: NextVisitQuestionsController<T>,
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
  return {
    isReviewing,
    isGenerating,
    isSaving,
    generateLabel,
    hasSharedAction: false,
  };
}
