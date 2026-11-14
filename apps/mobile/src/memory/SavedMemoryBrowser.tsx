import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { AgentMemoryHit } from '@orot/agent-memory';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime } from '../i18n';
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
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') close();
    });
    return () => {
      generation.current += 1;
      subscription.remove();
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
      <Text accessibilityRole="header" style={styles.title}>
        AI 메모리
      </Text>
      <Text style={styles.description}>
        오롯이 저장한 기억을 확인해요. 이 기기에서만 불러오며 AI에 전송하지
        않아요.
      </Text>
      <AppButton
        variant="neutral"
        title={expanded ? '메모리 닫기' : '저장된 메모리 보기'}
        onPress={
          expanded
            ? close
            : () => {
                refresh();
              }
        }
      />
      {expanded && (
        <>
          {state === 'loading' && (
            <Text accessibilityLiveRegion="polite">
              메모리를 불러오는 중이에요.
            </Text>
          )}
          {state === 'failed' && (
            <>
              <Text accessibilityRole="alert">
                메모리를 불러오지 못했어요. 기기를 잠금 해제한 뒤 다시 시도해
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
                  ? `저장된 메모리 ${rows.length}개`
                  : '아직 저장된 메모리가 없어요.'}
              </Text>
              <AppButton
                variant="neutral"
                title="새로고침"
                onPress={() => {
                  refresh();
                }}
              />
              {rows.slice(0, visible).map(row => (
                <View key={row.id} style={styles.row}>
                  <Text style={styles.kind}>{kindLabels[row.kind]}</Text>
                  <Text style={styles.body}>{row.text}</Text>
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
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  section: {
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: appColors.surface,
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
