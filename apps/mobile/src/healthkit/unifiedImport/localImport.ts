import { openLocalStorage } from '../../storage/secureDatabase';
import { healthKit } from '..';
import { healthKitFeatures } from '../types';
import { createUnifiedImportCoordinator } from './coordinator';
import { createUnifiedFeatureImporter } from './featureImporter';

const unifiedFeatureImporter = createUnifiedFeatureImporter({
  healthKit,
  now: () => new Date().toISOString(),
});

/** One explicit screen action imports only the selected HealthKit feature types. */
export const unifiedHealthImportCoordinator = createUnifiedImportCoordinator({
  healthKit: {
    requestReadAuthorizations: features =>
      healthKit.requestReadAuthorizations(features),
  },
  openRepository: openLocalStorage,
  runFeature: unifiedFeatureImporter,
});

export const unifiedHealthImportFeatures = healthKitFeatures;
