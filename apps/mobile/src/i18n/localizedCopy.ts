import { modelSettingsKo } from './modelSettings';
import { nextVisitCopyKo } from './nextVisitCopyKo';
import { encounterReviewCopyKo } from './encounterReviewCopyKo';

/** Incremental UI-copy migrations share one catalog entry point. */
export const localizedCopyKo = {
  ...modelSettingsKo,
  ...nextVisitCopyKo,
  ...encounterReviewCopyKo,
} as const;
