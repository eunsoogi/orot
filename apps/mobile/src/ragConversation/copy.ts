import { t } from '../i18n';

/** Resolves UI copy for the current render and localizes the citation label around its ID. */
export function getRagConversationCopy() {
  return {
    title: t('ragConversation.title'),
    description: t('ragConversation.description'),
    placeholder: t('ragConversation.placeholder'),
    send: t('ragConversation.send'),
    loading: t('ragConversation.loading'),
    noEvidence: t('ragConversation.noEvidence'),
    insufficient: t('ragConversation.insufficient'),
    unavailable: t('ragConversation.unavailable'),
    speakerUser: t('ragConversation.speakerUser'),
    source: (sourceId: string) => t('ragConversation.source', { sourceId }),
  };
}
