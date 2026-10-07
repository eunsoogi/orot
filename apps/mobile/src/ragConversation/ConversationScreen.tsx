import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import {
  DesignButton,
  DesignCard,
  DesignInput,
  DesignNotice,
  DesignScreen,
  DesignText,
  designTokens,
  useAppTheme,
} from '../design';
import { getRagConversationCopy } from './copy';
import type { RagConversationMessage } from './task';
import type { RagConversationOutcome } from './service';

interface DisplayMessage extends RagConversationMessage {
  readonly id: number;
  readonly citations?: readonly EvidenceReference[];
  readonly noticeTone?: 'warning' | 'danger';
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
  const { colors } = useAppTheme();
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
            : {
                noticeTone:
                  outcome.status === 'unavailable'
                    ? ('danger' as const)
                    : ('warning' as const),
              }),
        },
      ]);
    } catch {
      setError(copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DesignScreen
      backAction={{ label: copy.back, onPress: onBack }}
      description={copy.description}
      testID="rag-conversation-screen"
      title={copy.title}
    >
      {messages.map(message => (
        <DesignCard
          key={message.id}
          style={
            message.role === 'user'
              ? { backgroundColor: colors.accentSubtle }
              : undefined
          }
        >
          <DesignText variant="caption" tone="secondary">
            {message.role === 'user' ? copy.speakerUser : 'Orot'}
          </DesignText>
          {message.noticeTone ? (
            <DesignNotice message={message.content} tone={message.noticeTone} />
          ) : (
            <DesignText>{message.content}</DesignText>
          )}
          {message.citations?.map(reference => (
            <DesignButton
              key={`${reference.sourceId}:${reference.evidenceId}:${reference.evidenceRevision}`}
              label={copy.source(reference.sourceId)}
              onPress={() => onOpenSource(reference)}
              variant="quiet"
            />
          ))}
        </DesignCard>
      ))}
      {busy ? (
        <DesignNotice
          busy
          message={copy.loading}
          testID="rag-conversation-loading"
        />
      ) : null}
      {error ? <DesignNotice message={error} tone="danger" /> : null}
      {/* The composer stays in the scroll flow so large labels never cover earlier evidence. */}
      <View style={styles.composer}>
        <DesignInput
          label={copy.placeholder}
          editable={!busy}
          maxLength={1000}
          onChangeText={setDraft}
          placeholder={copy.placeholder}
          testID="rag-conversation-input"
          value={draft}
        />
        <DesignButton
          accessibilityState={{ busy }}
          disabled={busy || !draft.trim()}
          onPress={() => {
            send().catch(() => setError(copy.unavailable));
          }}
          testID="rag-conversation-send"
          label={copy.send}
        />
      </View>
    </DesignScreen>
  );
}

const styles = StyleSheet.create({
  composer: { gap: designTokens.spacing.md },
});
