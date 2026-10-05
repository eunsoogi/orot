import { healthKit } from '..';
import { openLocalStorage } from '../../storage/secureDatabase';
import { importCommonObservations } from './importer';
import type { CommonObservationFeature } from './types';

/** Uses feature-scoped read access and the app's encrypted local record repository. */
export async function importLocalCommonObservations(
  features: readonly CommonObservationFeature[],
) {
  const repository = await openLocalStorage();
  return importCommonObservations({
    features,
    healthKit,
    repository,
    now: () => new Date().toISOString(),
  });
}
