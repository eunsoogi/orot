import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useState, useSyncExternalStore } from 'react';
import { useConversationSessions } from './ConversationSessionsContext';
import type { ReactNode } from 'react';
import { AppSymbol } from '../layout/AppSymbol';
import { ConversationComposer } from './ConversationComposer';
import { ComposerGlassBackground } from './ComposerGlassBackground';
import { styles } from './ConversationScreen.styles';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { ConversationHistory } from './ConversationHistory';
import { navigationText } from '../i18n/navigation';
import type { EvidenceReference } from '@orot/agent-runtime';
import { getRagConversationCopy } from './copy';
import type { RagConversationMessage } from './task';
import type { RagConversationOutcome } from './service';
import type { RagConversationObserver } from './service';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';

interface ConversationScreenProps {
  readonly providerSelection?: ReactNode;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly onOpenHistory?: () => void;
  readonly onSend: (
    question: string,
    previousMessages: readonly RagConversationMessage[],
    signal?: AbortSignal,
    observer?: RagConversationObserver,
  ) => Promise<RagConversationOutcome>;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}

/** Subscribes to app-owned conversations; evidence is freshly loaded for each turn. */
export function ConversationScreen({
  navigationRouteKey,
  providerSelection,
  onNavigationStateChange,
  onBack,
  onOpenHistory,
  onSend,
  onOpenSource,
}: ConversationScreenProps) {
  const copy = getRagConversationCopy();
  const store = useConversationSessions();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = snapshot.sessions.find(
    item => item.id === snapshot.activeId,
  )!;
  const { id, draft, messages, pendingMessage, busy, error } = session;
  const [composerHeight, setComposerHeight] = useState(0);
  const cancel = () => store.cancel(id);
  // App-owned sessions keep drafts and requests alive when this route is removed.
  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: false,
      isRecording: false,
      hasOngoingOperation: false,
    },
    0,
    onNavigationStateChange,
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
      testID="rag-conversation-screen"
    >
      <View style={styles.header}>
        {!navigationRouteKey && (
          <Button
            accessibilityLabel={navigationText.back.accessibilityLabel}
            onPress={onBack}
            title={navigationText.back.label}
          />
        )}
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.heading}>
            {copy.title}
          </Text>
          <View style={styles.sessionActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.sessions}
              onPress={onOpenHistory}
              style={styles.sessionAction}
              testID="rag-conversation-sessions-toggle"
            >
              <ComposerGlassBackground testID="rag-conversation-history-glass" />
              <AppSymbol
                name="clock.arrow.circlepath"
                size={20}
                color={appColors.primaryText}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.newConversation}
              onPress={() => {
                store.create();
              }}
              style={styles.sessionAction}
              testID="rag-conversation-new-session"
            >
              <ComposerGlassBackground testID="rag-conversation-new-glass" />
              <AppSymbol name="plus" size={20} color={appColors.primaryText} />
            </Pressable>
          </View>
        </View>
        {providerSelection ? (
          <View style={styles.provider}>{providerSelection}</View>
        ) : null}
        {messages.length === 0 && !pendingMessage ? (
          <Text style={styles.description}>{copy.description}</Text>
        ) : null}
      </View>
      <View style={styles.history}>
        <ConversationHistory
          messages={messages}
          pendingMessage={pendingMessage}
          error={error}
          bottomInset={composerHeight}
          onOpenSource={onOpenSource}
          onLinkError={() =>
            store.setError(id, '문헌 링크를 열지 못했어요. 다시 시도해 주세요.')
          }
        />
        <ConversationComposer
          onLayout={event => setComposerHeight(event.nativeEvent.layout.height)}
          value={draft}
          busy={busy}
          onChangeText={value => store.setDraft(id, value)}
          onSend={() => {
            void store.send(id, onSend);
          }}
          onCancel={cancel}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
