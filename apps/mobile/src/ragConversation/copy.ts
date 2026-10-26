import { t } from '../i18n';

/** Resolves UI copy for the current render and localizes the citation label around its ID. */
export function getRagConversationCopy() {
  return {
    title: t('ragConversation.title'),
    description: t('ragConversation.description'),
    placeholder: t('ragConversation.placeholder'),
    send: t('ragConversation.send'),
    cancel: t('aiActivity.cancel'),
    sessions: t('ragConversation.sessions'),
    newConversation: t('ragConversation.newConversation'),
    disclaimer: t('ragConversation.disclaimer'),
    loading: t('ragConversation.loading'),
    progressAnswer: t('ragConversation.progressAnswer'),
    progressRevisedAnswer: t('ragConversation.progressRevisedAnswer'),
    progressResearch: t('ragConversation.progressResearch'),
    progressLocalSearch: t('ragConversation.progressLocalSearch'),
    progressExternalSearch: t('ragConversation.progressExternalSearch'),
    progressEvidenceComplete: t('ragConversation.progressEvidenceComplete'),
    progressEvidenceFailed: t('ragConversation.progressEvidenceFailed'),
    progressEvidenceCancelled: t('ragConversation.progressEvidenceCancelled'),
    progressCancelled: t('ragConversation.progressCancelled'),
    noEvidence: t('ragConversation.noEvidence'),
    insufficient: t('ragConversation.insufficient'),
    unavailable: t('ragConversation.unavailable'),
    speakerUser: t('ragConversation.speakerUser'),
    source: (sourceId: string) => t('ragConversation.source', { sourceId }),
  };
}
