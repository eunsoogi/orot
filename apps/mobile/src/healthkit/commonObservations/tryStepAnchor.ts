import { tryAdvanceStepAnchor } from '../../storage/workoutStepAnchorContract';
import {
  measureCommonObservationOperation,
  type SyncCommonObservationChangesOptions,
} from './syncOptions';

export function tryStepAnchor(
  options: SyncCommonObservationChangesOptions,
  pageHasChanges: boolean,
  previous: string | null,
  next: string | null,
) {
  if (
    options.feature !== 'steps' ||
    pageHasChanges ||
    !next ||
    previous === next
  )
    return undefined;
  const advance = tryAdvanceStepAnchor(
    options.repository,
    previous,
    next,
    options.now,
  );
  return (
    advance &&
    measureCommonObservationOperation(
      options.instrumentation,
      'persist',
      advance,
    )
  );
}
