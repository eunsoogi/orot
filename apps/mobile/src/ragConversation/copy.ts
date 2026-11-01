import { t } from '../i18n';
import type { RagConversationFailureKind } from './service';

/** Resolves UI copy for the current render and localizes the citation label around its ID. */
export function getRagConversationCopy() {
  return {
    title: t('ragConversation.title'),
    description: t('ragConversation.description'),
    evidenceTitle: t('ragConversation.evidenceTitle'),
    evidenceDescription: t('ragConversation.evidenceDescription'),
    evidenceEmpty: t('ragConversation.evidenceEmpty'),
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

/** Maps only typed failure categories to static recovery guidance; raw provider details stay private. */
export function getRagConversationFailureCopy(
  kind: RagConversationFailureKind,
): string {
  const keyByKind = {
    provider_authentication: 'ragConversation.failureAuthentication',
    provider_rate_limited: 'ragConversation.failureRateLimited',
    provider_configuration: 'ragConversation.failureProviderConfiguration',
    provider_refused: 'ragConversation.failureProviderRefused',
    provider_unavailable: 'ragConversation.failureProviderUnavailable',
    consent_required: 'ragConversation.failureConsentRequired',
    cancelled: 'ragConversation.failureCancelled',
    retrieval_failed: 'ragConversation.failureRetrieval',
    validation_failed: 'ragConversation.failureValidation',
    stale_evidence: 'ragConversation.failureStaleEvidence',
    budget_exceeded: 'ragConversation.failureBudget',
    unavailable: 'ragConversation.unavailable',
  } as const satisfies Record<RagConversationFailureKind, string>;
  return t(keyByKind[kind]);
}
