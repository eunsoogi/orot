import { useSyncExternalStore } from 'react';
import {
  Platform,
  Pressable,
  requireNativeComponent,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
  type ColorValue,
} from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { ComposerGlassBackground } from './ComposerGlassBackground';
import { useConversationSessions } from './ConversationSessionsContext';

interface HistoryRow {
  readonly id: number;
  readonly title: string;
  readonly time: string;
  readonly section: string;
  readonly selected: boolean;
}
interface NativeHistoryProps extends ViewProps {
  readonly rows: readonly HistoryRow[];
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

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = (item: Date) => item.toLocaleDateString('ko-KR');
  return key(date) === key(today)
    ? '오늘'
    : key(date) === key(yesterday)
      ? '어제'
      : key(date);
}

/** A separate native list owns trailing swipe gestures; app-owned sessions survive selection and undo. */
export function ConversationHistoryScreen({
  onBack,
}: {
  readonly onBack: () => void;
}) {
  const store = useConversationSessions();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const inset = useNavigationContentInset();
  const rows = [...state.sessions].reverse().map(session => ({
    id: session.id,
    title: session.title,
    selected: session.id === state.activeId,
    time: new Intl.DateTimeFormat('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(session.createdAt)),
    section: dayLabel(session.createdAt),
  }));
  const select = (id: number) => {
    store.select(id);
    onBack();
  };
  const create = () => {
    store.create();
    onBack();
  };
  return (
    <View style={[styles.screen, inset]} testID="conversation-history-screen">
      {/* UIKit scrolls this header with its rows, so large text cannot consume a fixed viewport. */}
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
              onPress={create}
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
          onCreateSession={create}
          onSelectSession={event => select(event.nativeEvent.id)}
          onDeleteSession={event => store.remove(event.nativeEvent.id)}
        />
      ) : (
        <View>
          {rows.map(row => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              accessibilityActions={[{ name: 'delete', label: '삭제' }]}
              onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'delete')
                  store.remove(row.id);
              }}
              onPress={() => select(row.id)}
            >
              <Text>{row.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {state.deleted ? (
        <View style={styles.undo} accessibilityLiveRegion="polite">
          <Text style={styles.undoMessage}>대화를 삭제했어요.</Text>
          <View style={styles.undoAction}>
            <AppButton
              title="실행 취소"
              variant="secondary"
              onPress={() => store.undoRemove()}
              testID="conversation-history-undo"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Match the selected large-title hierarchy without fixing header height or capping Dynamic Type.
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
  list: { flex: 1 },
  undo: {
    marginHorizontal: 24,
    padding: 12,
    borderRadius: 16,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    // Large accessibility labels must move to another line instead of escaping the screen.
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  undoMessage: { flexShrink: 1 },
  undoAction: { maxWidth: '100%', marginLeft: 'auto' },
});
