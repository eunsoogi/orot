import { t } from '../../i18n';
import type { CommonObservationsImportCopy } from './CommonObservationsImportScreen';

// Keep the common import screen's labels at the app edge, outside its UI state machine.
export const commonObservationsCopy: CommonObservationsImportCopy = {
  title: t('healthkit.commonObservations.title'),
  description: t('healthkit.commonObservations.description'),
  localOnly: t('healthkit.commonObservations.localOnly'),
  importButton: t('healthkit.commonObservations.import'),
  featureNames: {
    heartRate: t('healthkit.commonObservations.heartRate'),
    steps: t('healthkit.commonObservations.steps'),
    bodyMass: t('healthkit.commonObservations.bodyMass'),
  },
  statuses: {
    idle: t('healthkit.commonObservations.status.idle'),
    importing: t('healthkit.commonObservations.status.importing'),
    complete: t('healthkit.commonObservations.status.complete'),
    empty: t('healthkit.commonObservations.status.empty'),
    unavailable: t('healthkit.commonObservations.status.unavailable'),
    unsupportedFeature: t(
      'healthkit.commonObservations.status.unsupportedFeature',
    ),
    unsupportedPlatform: t(
      'healthkit.commonObservations.status.unsupportedPlatform',
    ),
    unsupportedData: t('healthkit.commonObservations.status.unsupportedData'),
    partial: t('healthkit.commonObservations.status.partial'),
    failed: t('healthkit.commonObservations.status.failed'),
  },
  changeSummary: (importedCount, deletedCount, unsupportedCount) =>
    t('healthkit.commonObservations.status.summary', {
      imported: importedCount,
      deleted: deletedCount,
      unsupported: unsupportedCount,
    }),
};
