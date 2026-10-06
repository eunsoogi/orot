import { eventKitCalendarImportBridge } from '../../calendar/calendarBridge';
import { openLocalStorage } from '../../storage/secureDatabase';
import { healthKit } from '..';
import { healthKitFeatures } from '../types';
import { createUnifiedImportCoordinator } from './coordinator';
import { createUnifiedFeatureImporter } from './featureImporter';

const unifiedFeatureImporter = createUnifiedFeatureImporter({
  healthKit,
  now: () => new Date().toISOString(),
});

/** One screen action may select HealthKit types and Calendar separately. */
export const unifiedHealthCalendarImportCoordinator =
  createUnifiedImportCoordinator({
    healthKit: {
      requestReadAuthorizations: features =>
        healthKit.requestReadAuthorizations(features),
    },
    calendar: eventKitCalendarImportBridge,
    openRepository: openLocalStorage,
    runFeature: unifiedFeatureImporter,
  });

export const unifiedHealthImportFeatures = healthKitFeatures;
