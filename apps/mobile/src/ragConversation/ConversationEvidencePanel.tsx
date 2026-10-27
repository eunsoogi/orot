import type { EvidenceReference } from '@orot/agent-runtime';
import { ScrollView, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { ConversationSources } from './ConversationSources';
import type { DisplayMessage } from './ConversationMessage';
import { styles } from './ConversationScreen.styles';
import { getRagConversationCopy } from './copy';

/** Mirrors only the latest answer's returned citations; it never loads or transmits evidence. */
export function ConversationEvidencePanel({
  messages,
  onOpenSource,
  onLinkError,
  bottomInset,
}: {
  readonly messages: readonly DisplayMessage[];
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly bottomInset: number;
}) {
  const latestAssistant = messages
    .slice()
    .reverse()
    .find(message => message.role === 'assistant');
  const references = latestAssistant?.citations ?? [];
  const copy = getRagConversationCopy();

  return (
    <View style={styles.evidencePanel} testID="rag-conversation-evidence-panel">
      <Text accessibilityRole="header" style={styles.evidenceHeading}>
        {copy.evidenceTitle}
      </Text>
      <Text style={styles.evidenceDescription}>{copy.evidenceDescription}</Text>
      <ScrollView
        contentContainerStyle={[
          styles.evidenceContent,
          { paddingBottom: bottomInset + 20 },
        ]}
        keyboardShouldPersistTaps="handled"
        style={styles.evidenceSources}
        testID="rag-conversation-evidence-list"
      >
        {references.length > 0 ? (
          <ConversationSources
            references={references}
            onOpenSource={onOpenSource}
            onLinkError={onLinkError}
          />
        ) : (
          <Text
            style={styles.evidenceEmpty}
            testID="rag-conversation-evidence-empty"
          >
            {copy.evidenceEmpty}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
