import { t } from '../i18n';

/** Resolves display labels from the catalog and keeps evidence IDs as interpolated data. */
export function getDiseaseHypothesisCopy() {
  return {
    summaryTitle: t('diseaseHypotheses.summaryTitle'),
    summaryGenerate: t('diseaseHypotheses.summaryGenerate'),
    summaryRetry: t('diseaseHypotheses.summaryRetry'),
    summaryError: t('diseaseHypotheses.summaryError'),
    consentRequired: t('diseaseHypotheses.consentRequired'),
    summaryInsufficient: t('diseaseHypotheses.summaryInsufficient'),
    summaryExplanation: t('diseaseHypotheses.summaryExplanation'),
    summaryScope: t('diseaseHypotheses.summaryScope'),
    title: t('diseaseHypotheses.title'),
    explanation: t('diseaseHypotheses.explanation'),
    generate: t('diseaseHypotheses.generate'),
    loading: t('diseaseHypotheses.loading'),
    insufficient: t('diseaseHypotheses.insufficient'),
    error: t('diseaseHypotheses.error'),
    safetyRefusal: t('diseaseHypotheses.safetyRefusal'),
    selectProvider: t('diseaseHypotheses.selectProvider'),
    unsupportedInput: t('diseaseHypotheses.unsupportedInput'),
    uncertainty: t('diseaseHypotheses.uncertainty'),
    missingData: t('diseaseHypotheses.missingData'),
    supporting: t('diseaseHypotheses.supporting'),
    contrary: t('diseaseHypotheses.contrary'),
    noContrary: t('diseaseHypotheses.noContrary'),
    noAdditionalInfo: t('diseaseHypotheses.noAdditionalInfo'),
    source: (sourceId: string) => t('diseaseHypotheses.source', { sourceId }),
    retry: t('diseaseHypotheses.retry'),
    cancel: t('aiActivity.cancel'),
    cancelled: t('aiActivity.cancelled'),
    incompleteHeading: t('aiActivity.draft.incompleteHeading'),
    incompleteNote: t('aiActivity.draft.incompleteNote'),
    draftHeading: t('aiActivity.draft.heading'),
    draftNote: t('aiActivity.draft.note'),
  };
}
