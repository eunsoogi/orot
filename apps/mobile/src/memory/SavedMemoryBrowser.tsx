import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { AgentMemoryHit } from '@orot/agent-memory';
import { AppSymbol } from '../layout/AppSymbol';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { loadSavedLocalMemories } from './savedLocalMemories';

type SavedMemory = Omit<AgentMemoryHit, 'score'>;
const kindLabels = {
  preference: t('savedMemory.preference'),
  reviewed_interaction: t('savedMemory.reviewedInteraction'),
  task_context: t('savedMemory.taskContext'),
};

/** Loads on Records entry; privacy boundaries invalidate every late result. */
export function SavedMemoryBrowser({
  load = loadSavedLocalMemories,
}: {
  readonly load?: () => Promise<SavedMemory[]>;
}) {
  const [expanded, setExpanded] = useState(true);
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

  const refresh = useCallback(async () => {
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
  }, [load]);

  useEffect(() => {
    // Deletion fences invalidate cached text and pending reads, even if later cleanup fails.
    const unsubscribeClear = subscribeLocalDataClear(close);
    const unsubscribeSource = subscribeLocalSourceDeletion(close);
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') close();
      else refresh();
    });
    // Wait for confirmed foreground state; an unknown initial state is not permission to expose local text.
    if (AppState.currentState === 'active') {
      refresh();
    }
    return () => {
      generation.current += 1;
      subscription.remove();
      unsubscribeClear();
      unsubscribeSource();
    };
  }, [refresh]);

  return (
    <View style={styles.section} testID="saved-memory-browser">
      {!expanded && (
        <View style={styles.entry}>
          <AppButton
            variant="list"
            title={t('savedMemory.title')}
            summary={t('savedMemory.summary')}
            accessibilityLabel={
              expanded
                ? t('savedMemory.closeMemory')
                : t('savedMemory.openMemory')
            }
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
      )}
      {expanded && (
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {t('savedMemory.title')}
            </Text>
            {state === 'ready' && (
              <AppButton
                variant="neutral"
                size="compact"
                title={t('savedMemory.refresh')}
                onPress={() => {
                  refresh();
                }}
              />
            )}
          </View>
          <Text style={styles.description}>{t('savedMemory.privacy')}</Text>
          {state === 'loading' && (
            <Text accessibilityLiveRegion="polite">
              {t('savedMemory.loading')}
            </Text>
          )}
          {state === 'failed' && (
            <>
              <Text accessibilityRole="alert">{t('savedMemory.failed')}</Text>
              <AppButton
                variant="neutral"
                title={t('savedMemory.retry')}
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
                  ? t('savedMemory.count', { count: rows.length })
                  : t('savedMemory.empty')}
              </Text>
              {rows.slice(0, visible).map(row => (
                <View key={row.id} style={styles.row}>
                  <Text style={styles.body}>{row.text}</Text>
                  <Text style={styles.kind}>{kindLabels[row.kind]}</Text>
                  <Text style={styles.description}>
                    {t('savedMemory.savedAt', {
                      date: formatDateTime(new Date(row.createdAt)),
                    })}
                  </Text>
                  <Text style={styles.description}>
                    {row.provenance.reviewState === 'user_confirmed'
                      ? t('savedMemory.confirmed')
                      : t('savedMemory.reviewed')}{' '}
                    {t('savedMemory.sources', {
                      count: row.provenance.sourceIds.length,
                    })}
                  </Text>
                </View>
              ))}
              {visible < rows.length && (
                <AppButton
                  variant="neutral"
                  title={t('savedMemory.more')}
                  onPress={() => setVisible(value => value + 20)}
                />
              )}
            </>
          )}
          <AppButton
            variant="neutral"
            title={t('savedMemory.close')}
            accessibilityLabel={t('savedMemory.closeMemory')}
            accessibilityState={{ expanded: true }}
            onPress={close}
          />
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
