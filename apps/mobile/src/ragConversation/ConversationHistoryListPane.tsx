import {
  Platform,
  Pressable,
  requireNativeComponent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ComposerGlassBackground } from './ComposerGlassBackground';
import type { ConversationHistoryRow } from './ConversationHistoryScreen';

interface NativeHistoryProps extends ViewProps {
  readonly rows: readonly ConversationHistoryRow[];
  readonly headerTitle: string;
  readonly headerCount: string;
  readonly newSessionLabel: string;
  readonly headerTextColor: ColorValue;
  readonly headerSecondaryColor: ColorValue;
  readonly headerTintColor: ColorValue;
  readonly onCreateSession: () => void;
  readonly onSelectSession: (
    event: NativeSyntheticEvent<{ id: number }>,
  ) => void;
  readonly onDeleteSession: (
    event: NativeSyntheticEvent<{ id: number }>,
  ) => void;
}

const NativeHistory =
  Platform.OS === 'ios'
    ? requireNativeComponent<NativeHistoryProps>('ConversationHistoryView')
    : null;

/** Keeps UIKit row gestures and reversible deletion tied to the existing session actions. */
export function ConversationHistoryListPane({
  deleted,
  onCreateSession,
  onDeleteSession,
  onSelectSession,
  onUndoRemove,
  rows,
}: {
  readonly deleted: boolean;
  readonly onCreateSession: () => void;
  readonly onDeleteSession: (id: number) => void;
  readonly onSelectSession: (id: number) => void;
  readonly onUndoRemove: () => void;
  readonly rows: readonly ConversationHistoryRow[];
}) {
  return (
    <View style={styles.pane}>
      {!NativeHistory ? (
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.heading}>
              대화 기록
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="새 대화"
              style={styles.newButton}
              onPress={onCreateSession}
              testID="conversation-history-new"
            >
              <ComposerGlassBackground />
              <AppSymbol name="plus" size={20} color={appColors.primaryText} />
            </Pressable>
          </View>
          <Text style={styles.count}>{rows.length}개의 대화</Text>
        </View>
      ) : null}
      {NativeHistory ? (
        <NativeHistory
          testID="conversation-history-list"
          style={styles.list}
          rows={rows}
          headerTitle="대화 기록"
          headerCount={`${rows.length}개의 대화`}
          newSessionLabel="새 대화"
          headerTextColor={appColors.text}
          headerSecondaryColor={appColors.secondary}
          headerTintColor={appColors.primaryText}
          onCreateSession={onCreateSession}
          onSelectSession={event => onSelectSession(event.nativeEvent.id)}
          onDeleteSession={event => onDeleteSession(event.nativeEvent.id)}
        />
      ) : (
        <ScrollView style={styles.list}>
          {rows.map(row => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              accessibilityActions={[{ name: 'delete', label: '삭제' }]}
              onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'delete')
                  onDeleteSession(row.id);
              }}
              onPress={() => onSelectSession(row.id)}
            >
              <Text>{row.title}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {deleted ? (
        <View style={styles.undo} accessibilityLiveRegion="polite">
          <Text style={styles.undoMessage}>대화를 삭제했어요.</Text>
          <View style={styles.undoAction}>
            <AppButton
              title="실행 취소"
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
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Keep the large title in the scrolling hierarchy instead of fixing its viewport height.
  heading: { flex: 1, fontSize: 34, fontWeight: '700' },
  count: { color: appColors.secondary, fontSize: 14 },
  newButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { flex: 1, minWidth: 0, minHeight: 0 },
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
