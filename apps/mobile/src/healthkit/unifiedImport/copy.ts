import { t } from '../../i18n';
import type { HealthKitImportScreenCopy } from './HealthKitImportScreen';

/** Uses product translations while keeping unknown read grants out of the status copy. */
export const unifiedHealthImportCopy: HealthKitImportScreenCopy = {
  title: t('healthkit.unifiedImport.title'),
  description: t('healthkit.unifiedImport.description'),
  localOnly: t('healthkit.unifiedImport.localOnly'),
  readAuthorization: t('healthkit.unifiedImport.readAuthorization'),
  importButton: t('healthkit.unifiedImport.import'),
  cancelButton: t('healthkit.unifiedImport.cancel'),
  featureNames: {
    medications: t('healthkit.unifiedImport.feature.medications'),
    bloodPressure: t('healthkit.unifiedImport.feature.bloodPressure'),
    sleep: t('healthkit.unifiedImport.feature.sleep'),
    heartRate: t('healthkit.unifiedImport.feature.heartRate'),
    steps: t('healthkit.unifiedImport.feature.steps'),
    bodyMass: t('healthkit.unifiedImport.feature.bodyMass'),
  },
  featureStatuses: {
    notSelected: t('healthkit.unifiedImport.featureStatus.notSelected'),
    waitingAuthorization: t(
      'healthkit.unifiedImport.featureStatus.waitingAuthorization',
    ),
    ready: t('healthkit.unifiedImport.featureStatus.ready'),
    querying: t('healthkit.unifiedImport.featureStatus.querying'),
    persisting: t('healthkit.unifiedImport.featureStatus.persisting'),
    complete: t('healthkit.unifiedImport.featureStatus.complete'),
    empty: t('healthkit.unifiedImport.featureStatus.empty'),
    partial: t('healthkit.unifiedImport.featureStatus.partial'),
    unsupportedFeature: t(
      'healthkit.unifiedImport.featureStatus.unsupportedFeature',
    ),
    unsupportedPlatform: t(
      'healthkit.unifiedImport.featureStatus.unsupportedPlatform',
    ),
    unavailable: t('healthkit.unifiedImport.featureStatus.unavailable'),
    unsupportedData: t('healthkit.unifiedImport.featureStatus.unsupportedData'),
    notRun: t('healthkit.unifiedImport.featureStatus.notRun'),
    failed: t('healthkit.unifiedImport.featureStatus.failed'),
    cancelled: t('healthkit.unifiedImport.featureStatus.cancelled'),
  },
  phaseStatuses: {
    queued: t('healthkit.unifiedImport.phase.queued'),
    authorizingHealthKit: t(
      'healthkit.unifiedImport.phase.authorizingHealthKit',
    ),
    authorizingEventKit: t('healthkit.unifiedImport.phase.authorizingEventKit'),
    preparingStorage: t('healthkit.unifiedImport.phase.preparingStorage'),
    querying: t('healthkit.unifiedImport.phase.querying'),
    queryingEventKit: t('healthkit.unifiedImport.phase.queryingEventKit'),
    cancelling: t('healthkit.unifiedImport.phase.cancelling'),
    complete: t('healthkit.unifiedImport.phase.complete'),
    empty: t('healthkit.unifiedImport.phase.empty'),
    partial: t('healthkit.unifiedImport.phase.partial'),
    failed: t('healthkit.unifiedImport.phase.failed'),
    cancelled: t('healthkit.unifiedImport.phase.cancelled'),
  },
  changeSummary: (imported, deleted) =>
    t('healthkit.unifiedImport.changeSummary', { imported, deleted }),
};
