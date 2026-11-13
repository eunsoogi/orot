import { useState } from 'react';
import {
  Platform,
  Pressable,
  requireNativeComponent,
  StyleSheet,
  View,
} from 'react-native';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ConversationHistoryHeader } from './ConversationHistoryHeader';
import type { ConversationHistoryRow } from './ConversationHistoryScreen';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { t } from '../i18n';

interface NativeHistoryProps extends ViewProps {
  readonly rows: readonly ConversationHistoryRow[];
  readonly onSelectSession: (
    event: NativeSyntheticEvent<{ id: number }>,
  ) => void;
  readonly onDeleteSession: (
    event: NativeSyntheticEvent<{ id: number }>,
  ) => void;
  readonly onContentHeightChange: (
    event: NativeSyntheticEvent<{ height: number }>,
  ) => void;
}

const NativeHistory =
  Platform.OS === 'ios'
    ? requireNativeComponent<NativeHistoryProps>('ConversationHistoryView')
    : null;

/** Keeps UIKit row gestures beside the React-owned header and reversible session actions. */
export function ConversationHistoryListPane({
  deleted,
  onCreateSession,
  onDeleteSession,
  onOpenSavedAnalysis,
  onOpenSavedVisitQuestions,
  onSelectSession,
  onUndoRemove,
  rows,
}: {
  readonly deleted: boolean;
  readonly onCreateSession: () => void;
  readonly onDeleteSession: (id: number) => void;
  readonly onOpenSavedAnalysis?: () => void;
  readonly onOpenSavedVisitQuestions?: () => void;
  readonly onSelectSession: (id: number) => void;
  readonly onUndoRemove: () => void;
  readonly rows: readonly ConversationHistoryRow[];
}) {
  const [nativeHeight, setNativeHeight] = useState(1);
  const hasDock = useNavigationRouteActions([
    {
      id: 'new-history-session',
      label: t('ragConversation.history.newConversation'),
      accessibilityLabel: t('ragConversation.history.newConversation'),
      testID: 'conversation-history-new',
      systemImageName: 'plus',
      onPress: onCreateSession,
    },
  ]);
  return (
    <View style={styles.pane} testID="conversation-history-pane">
      <ConversationHistoryHeader
        conversationCount={rows.length}
        onCreateSession={onCreateSession}
        onOpenSavedAnalysis={onOpenSavedAnalysis}
        onOpenSavedVisitQuestions={onOpenSavedVisitQuestions}
        showNewSession={!hasDock}
      />
      {NativeHistory ? (
        <NativeHistory
          testID="conversation-history-list"
          style={[styles.list, { height: nativeHeight }]}
          rows={rows}
          onSelectSession={event => onSelectSession(event.nativeEvent.id)}
          onDeleteSession={event => onDeleteSession(event.nativeEvent.id)}
          onContentHeightChange={event => {
            const height = event.nativeEvent.height;
            if (Number.isFinite(height) && height > 0)
              setNativeHeight(previous =>
                Math.abs(previous - height) < 0.5 ? previous : height,
              );
          }}
        />
      ) : (
        <View style={styles.list}>
          {rows.map(row => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              accessibilityActions={[
                {
                  name: 'delete',
                  label: t('ragConversation.history.deleteAction'),
                },
              ]}
              onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'delete')
                  onDeleteSession(row.id);
              }}
              onPress={() => onSelectSession(row.id)}
            >
              <Text>{row.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {deleted ? (
        <View style={styles.undo} accessibilityLiveRegion="polite">
          <Text style={styles.undoMessage}>
            {t('ragConversation.history.deleted')}
          </Text>
          <View style={styles.undoAction}>
            <AppButton
              title={t('ragConversation.history.undoDelete')}
              variant="secondary"
              onPress={onUndoRemove}
              testID="conversation-history-undo"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1, minWidth: 0, minHeight: 0 },
  list: { minWidth: 0 },
  undo: {
    marginHorizontal: 24,
    padding: 12,
    borderRadius: 16,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    // Large accessibility labels wrap instead of escaping the history panel.
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  undoMessage: { flexShrink: 1 },
  undoAction: { maxWidth: '100%', marginLeft: 'auto' },
});
