import { t } from '../i18n';

/** Resolves display labels from the catalog and keeps evidence IDs as interpolated data. */
export function getDiseaseHypothesisCopy() {
  return {
    title: t('diseaseHypotheses.title'),
    explanation: t('diseaseHypotheses.explanation'),
    generate: t('diseaseHypotheses.generate'),
    loading: t('diseaseHypotheses.loading'),
    insufficient: t('diseaseHypotheses.insufficient'),
    error: t('diseaseHypotheses.error'),
    uncertainty: t('diseaseHypotheses.uncertainty'),
    missingData: t('diseaseHypotheses.missingData'),
    supporting: t('diseaseHypotheses.supporting'),
    contrary: t('diseaseHypotheses.contrary'),
    noContrary: t('diseaseHypotheses.noContrary'),
    noAdditionalInfo: t('diseaseHypotheses.noAdditionalInfo'),
    source: (sourceId: string) => t('diseaseHypotheses.source', { sourceId }),
    retry: t('diseaseHypotheses.retry'),
  };
}
