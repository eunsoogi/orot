import { t } from '../i18n';

/** Labels never replace durable tool IDs or invent an unknown tool's purpose. */
export const conversationToolLabelKeys = {
  'local-health-context': 'health',
  'local-personal-records': 'records',
  'local-reviewed-memory': 'memory',
  'local-generated-artifacts': 'summaries',
  'local-conversation-artifacts': 'conversations',
  'local-research-artifacts': 'research',
  'artifact-personal-source': 'recordSource',
  'artifact-reviewed-memory-source': 'memorySource',
  'public-web-search': 'web',
  'europe-pmc-publication-search': 'literature',
  'visit-question-personal-record-search': 'records',
  'visit-question-reviewed-memory-search': 'memory',
} as const;

/** Future tool IDs receive an honest fallback, not an internal implementation name. */
export function conversationToolLabel(id: string): string {
  const key =
    conversationToolLabelKeys[id as keyof typeof conversationToolLabelKeys];
  return key
    ? t(`ragConversation.tool.name.${key}`)
    : t('ragConversation.tool.name.unknown');
}
