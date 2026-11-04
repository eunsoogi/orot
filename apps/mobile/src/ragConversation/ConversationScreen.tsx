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
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { ConversationHistory } from './ConversationHistory';
import { navigationText } from '../i18n/navigation';
import type { EvidenceReference } from '@orot/agent-runtime';
import { getRagConversationCopy } from './copy';
import type { RagConversationMessage } from './task';
import type { RagConversationOutcome } from './service';
import type { RagConversationObserver } from './service';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useNavigationOcclusion } from '../navigation/useNavigationContentInset';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { conversationComposerLayout } from './conversationComposerLayout';

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

/** Presents app-owned sessions as a transcript above a persistent composer. */
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
  const [contentHeight, setContentHeight] = useState(0);
  const { fontScale } = useWindowDimensions();
  const occlusion = useNavigationOcclusion();
  const hasRightRail = occlusion.placement === 'right';
  const composerLayout = conversationComposerLayout(
    contentHeight,
    occlusion.scrollContentInsets.bottom,
    fontScale,
  );
  const store = useConversationSessions();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = snapshot.sessions.find(
    item => item.id === snapshot.activeId,
  )!;
  const { id, draft, messages, pendingMessage, busy, error } = session;
  // The shell places Back before this group; preserve history before new session within the page actions.
  const hasDockActions = useNavigationRouteActions(
    hasRightRail
      ? [
          {
            id: 'conversation-history',
            label: copy.sessions,
            accessibilityLabel: copy.sessions,
            testID: 'rag-conversation-sessions-toggle',
            systemImageName: 'clock.arrow.circlepath',
            disabled: !onOpenHistory,
            onPress: () => onOpenHistory?.(),
          },
          {
            id: 'conversation-new-session',
            label: copy.newConversation,
            accessibilityLabel: copy.newConversation,
            testID: 'rag-conversation-new-session',
            systemImageName: 'plus',
            onPress: () => {
              store.create();
            },
          },
        ]
      : [],
  );
  // The bottom layout keeps the existing title-row actions used on iPhone.
  const showSessionActionsInHeader = !hasRightRail || !hasDockActions;
  const cancel = () => store.cancel(id);
  const onLinkError = () =>
    store.setError(id, '출처를 열지 못했어요. 다시 시도해 주세요.');
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

  const header = (
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
        {showSessionActionsInHeader ? (
          <View style={styles.sessionActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.sessions}
              disabled={!onOpenHistory}
              onPress={onOpenHistory}
              style={[styles.sessionAction, !onOpenHistory && styles.disabled]}
              testID="rag-conversation-sessions-toggle"
            >
              <ComposerGlassBackground testID="rag-conversation-history-glass" />
              <AppSymbol
                name="clock.arrow.circlepath"
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
              <AppSymbol name="plus" color={appColors.primaryText} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {providerSelection ? (
        <View style={styles.provider}>{providerSelection}</View>
      ) : null}
      <Text style={styles.disclaimer}>{copy.transmissionNotice}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={
        !navigationRouteKey && Platform.OS === 'ios' ? 'padding' : undefined
      }
      style={styles.screen}
      testID="rag-conversation-screen"
    >
      <AdaptiveColumns
        routeKey={navigationRouteKey}
        testID="rag-conversation-columns"
        primary={
          <View
            style={styles.content}
            onLayout={event =>
              setContentHeight(event.nativeEvent.layout.height)
            }
          >
            <ConversationHistory
              compact={composerLayout.compact}
              header={header}
              messages={messages}
              pendingMessage={pendingMessage}
              error={error}
              unsavedCount={session.unsavedCount}
              retryingSave={session.retryingSave || busy}
              onRetrySave={() => {
                store.retrySave(id);
              }}
              restoreFailed={session.restoreFailed}
              onRetryRestore={() => {
                store.retryRestore(id);
              }}
              onOpenSource={onOpenSource}
              onLinkError={onLinkError}
              footer={
                composerLayout.compact ? (
                  <Text style={styles.disclaimer}>{copy.disclaimer}</Text>
                ) : null
              }
            />
            <ConversationComposer
              value={draft}
              busy={busy}
              disabled={
                session.restoring ||
                session.restoreFailed ||
                session.quarantined ||
                session.retryingSave ||
                (session.restoreAfterRetry && Boolean(session.unsavedCount))
              }
              compact={composerLayout.compact}
              maximumInputHeight={composerLayout.maximumInputHeight}
              onChangeText={value => store.setDraft(id, value)}
              onSend={() => {
                store.send(id, onSend);
              }}
              onCancel={cancel}
            />
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}
