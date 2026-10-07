import { useRef, useState } from 'react';
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { getRagConversationCopy } from './copy';
import type { RagConversationMessage } from './task';
import type { RagConversationOutcome } from './service';

interface DisplayMessage extends RagConversationMessage {
  readonly id: number;
  readonly citations?: readonly EvidenceReference[];
}

interface ConversationScreenProps {
  readonly onBack: () => void;
  readonly onSend: (
    question: string,
    previousMessages: readonly RagConversationMessage[],
  ) => Promise<RagConversationOutcome>;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}

/** Keeps chat history in view state only; evidence is freshly loaded by the injected turn service. */
export function ConversationScreen({
  onBack,
  onSend,
  onOpenSource,
}: ConversationScreenProps) {
  const copy = getRagConversationCopy();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<readonly DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextMessageId = useRef(0);

  async function send() {
    const question = draft.trim();
    if (!question || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    const userMessage = {
      id: ++nextMessageId.current,
      role: 'user' as const,
      content: question,
    };
    setMessages(current => [...current, userMessage]);
    setDraft('');
    setBusy(true);
    setError('');
    try {
      const outcome = await onSend(question, history);
      const assistantContent =
        outcome.status === 'answer'
          ? outcome.answer
          : outcome.status === 'no_evidence'
            ? copy.noEvidence
            : outcome.status === 'insufficient'
              ? copy.insufficient
              : copy.unavailable;
      setMessages(current => [
        ...current,
        {
          id: ++nextMessageId.current,
          role: 'assistant',
          content: assistantContent,
          ...(outcome.status === 'answer'
            ? { citations: outcome.citations }
            : {}),
        },
      ]);
    } catch {
      setError(copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="rag-conversation-screen"
    >
      <Button onPress={onBack} title={copy.back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {copy.title}
      </Text>
      <Text>{copy.description}</Text>
      {messages.map(message => (
        <View key={message.id} style={styles.message}>
          <Text style={styles.role}>
            {message.role === 'user' ? copy.speakerUser : 'Orot'}
          </Text>
          <Text>{message.content}</Text>
          {message.citations?.map(reference => (
            <Pressable
              key={`${reference.sourceId}:${reference.evidenceId}:${reference.evidenceRevision}`}
              accessibilityRole="button"
              onPress={() => onOpenSource(reference)}
            >
              <Text style={styles.source}>
                {copy.source(reference.sourceId)}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
      {busy ? (
        <Text testID="rag-conversation-loading">{copy.loading}</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <TextInput
        accessibilityLabel={copy.placeholder}
        editable={!busy}
        maxLength={1000}
        onChangeText={setDraft}
        placeholder={copy.placeholder}
        testID="rag-conversation-input"
        value={draft}
      />
      <Button
        disabled={busy || !draft.trim()}
        onPress={() => {
          send().catch(() => setError(copy.unavailable));
        }}
        testID="rag-conversation-send"
        title={copy.send}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  heading: { fontSize: 22, fontWeight: '700' },
  message: {
    borderColor: '#C9D4D1',
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  role: { fontWeight: '700' },
  source: { color: '#174F45', fontWeight: '700', paddingVertical: 4 },
});
