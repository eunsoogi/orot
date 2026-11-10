import type {
  ConversationToolEvent,
  ToolSourceReference,
} from '@orot/agent-runtime';
import { t } from '../i18n';

/** Share safe source labels and identity keys without coupling the row and source components. */
export function sourceKindLabel(
  sourceKind: ConversationToolEvent['inputSummary']['sourceKind'],
) {
  switch (sourceKind) {
    case 'personal_record':
      return t('ragConversation.tool.sourceKind.personalRecord');
    case 'reviewed_memory':
      return t('ragConversation.tool.sourceKind.reviewedMemory');
    case 'generated_artifact':
      return t('ragConversation.tool.sourceKind.generatedArtifact');
    case 'external_medical':
      return t('ragConversation.tool.sourceKind.externalMedical');
  }
}

/** Keep source state tied to its full persisted identity, including both revisions. */
export function sourceKey(source: ToolSourceReference) {
  return [
    source.sourceKind,
    source.sourceId,
    source.sourceRevision,
    source.evidenceId,
    source.evidenceRevision,
  ].join(':');
}
