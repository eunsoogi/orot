import { t } from '../i18n';

/** Keeps labels localized while passing publication metadata as display data. */
export function getExternalMedicalEvidenceCopy() {
  return {
    back: t('aiFeatures.back'),
    title: t('externalMedicalEvidence.title'),
    description: t('externalMedicalEvidence.description'),
    placeholder: t('externalMedicalEvidence.placeholder'),
    search: t('externalMedicalEvidence.search'),
    loading: t('externalMedicalEvidence.loading'),
    consent: t('externalMedicalEvidence.consent'),
    consentRequired: t('externalMedicalEvidence.consentRequired'),
    empty: t('externalMedicalEvidence.empty'),
    unavailable: t('externalMedicalEvidence.unavailable'),
    publicationDate: (date: string) =>
      t('externalMedicalEvidence.publicationDate', { date }),
    updatedDate: (date: string) =>
      t('externalMedicalEvidence.updatedDate', { date }),
    unknownDate: t('externalMedicalEvidence.unknownDate'),
    retrievedAt: (time: string) =>
      t('externalMedicalEvidence.retrievedAt', { time }),
    source: (provider: string) =>
      t('externalMedicalEvidence.source', { provider }),
    open: t('externalMedicalEvidence.open'),
    authorUnknown: t('externalMedicalEvidence.authorUnknown'),
  };
}
