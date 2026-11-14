import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { AgentMemoryHit } from '@orot/agent-memory';
import { AppSymbol } from '../layout/AppSymbol';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime } from '../i18n';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { loadSavedLocalMemories } from './savedLocalMemories';

type SavedMemory = Omit<AgentMemoryHit, 'score'>;
const kindLabels = {
  preference: '선호',
  reviewed_interaction: '검토한 대화',
  task_context: '작업 맥락',
};

/** Reads only after an explicit open; closing or backgrounding invalidates every late result. */
export function SavedMemoryBrowser({
  load = loadSavedLocalMemories,
}: {
  readonly load?: () => Promise<SavedMemory[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<SavedMemory[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    'idle',
  );
  const [visible, setVisible] = useState(20);
  const generation = useRef(0);

  const close = () => {
    generation.current += 1;
    setExpanded(false);
    setRows([]);
    setState('idle');
  };
  useEffect(() => {
    // Deletion fences invalidate cached text and pending reads, even if later cleanup fails.
    const unsubscribeClear = subscribeLocalDataClear(close);
    const unsubscribeSource = subscribeLocalSourceDeletion(close);
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') close();
    });
    return () => {
      generation.current += 1;
      subscription.remove();
      unsubscribeClear();
      unsubscribeSource();
    };
  }, []);

  const refresh = async () => {
    const request = ++generation.current;
    setExpanded(true);
    setState('loading');
    setRows([]);
    setVisible(20);
    try {
      const result = await load();
      if (generation.current !== request) return;
      setRows(result);
      setState('ready');
    } catch {
      if (generation.current === request) setState('failed');
    }
  };

  return (
    <View style={styles.section} testID="saved-memory-browser">
      <View style={styles.entry}>
        <AppButton
          variant="list"
          title="기억"
          summary="이 기기에 저장된 기억을 확인해요"
          accessibilityLabel={expanded ? '기억 닫기' : '저장된 기억 보기'}
          accessibilityState={{ expanded }}
          trailingContent={
            <AppSymbol
              name={expanded ? 'chevron.down' : 'chevron.right'}
              size={16}
              color={appColors.secondary}
            />
          }
          onPress={
            expanded
              ? close
              : () => {
                  refresh();
                }
          }
        />
      </View>
      {expanded && (
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              기억
            </Text>
            {state === 'ready' && (
              <AppButton
                variant="neutral"
                size="compact"
                title="새로고침"
                onPress={() => {
                  refresh();
                }}
              />
            )}
          </View>
          <Text style={styles.description}>
            이 기기에서만 불러오며 AI에 전송하지 않아요.
          </Text>
          {state === 'loading' && (
            <Text accessibilityLiveRegion="polite">
              기억을 불러오는 중이에요.
            </Text>
          )}
          {state === 'failed' && (
            <>
              <Text accessibilityRole="alert">
                기억을 불러오지 못했어요. 기기를 잠금 해제한 뒤 다시 시도해
                주세요.
              </Text>
              <AppButton
                variant="neutral"
                title="다시 시도"
                onPress={() => {
                  refresh();
                }}
              />
            </>
          )}
          {state === 'ready' && (
            <>
              <Text accessibilityLiveRegion="polite">
                {rows.length
                  ? `저장된 기억 ${rows.length}개`
                  : '아직 저장된 기억이 없어요.'}
              </Text>
              {rows.slice(0, visible).map(row => (
                <View key={row.id} style={styles.row}>
                  <Text style={styles.body}>{row.text}</Text>
                  <Text style={styles.kind}>{kindLabels[row.kind]}</Text>
                  <Text style={styles.description}>
                    저장: {formatDateTime(new Date(row.createdAt))}
                  </Text>
                  <Text style={styles.description}>
                    {row.provenance.reviewState === 'user_confirmed'
                      ? '사용자 확인'
                      : '사람이 검토'}{' '}
                    · 출처 {row.provenance.sourceIds.length}개
                  </Text>
                </View>
              ))}
              {visible < rows.length && (
                <AppButton
                  variant="neutral"
                  title="더 보기"
                  onPress={() => setVisible(value => value + 20)}
                />
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12, minWidth: 0 },
  entry: {
    borderRadius: 18,
    backgroundColor: appColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  panel: {
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: appColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  // Wrapping keeps shared 44pt controls and large text inside narrow layouts.
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: appColors.text },
  description: { fontSize: 14, lineHeight: 20, color: appColors.secondary },
  row: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
  },
  kind: { fontSize: 14, fontWeight: '600', color: appColors.secondary },
  body: { fontSize: 16, lineHeight: 24, color: appColors.text },
});
