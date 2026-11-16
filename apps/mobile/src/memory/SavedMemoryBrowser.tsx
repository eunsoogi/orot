import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
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

import { savedMemoryStyles as styles } from './savedMemoryStyles';

const READ_WAIT_MS = 10_000;

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
  const active = useRef(AppState.currentState === 'active');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReadTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const close = useCallback(() => {
    clearReadTimer();
    generation.current += 1;
    setExpanded(false);
    setRows([]);
    setState('idle');
  }, [clearReadTimer]);

  const refresh = useCallback(async () => {
    // A queued press after backgrounding must not start a protected read.
    if (!active.current) return;
    clearReadTimer();
    const request = ++generation.current;
    setExpanded(true);
    setState('loading');
    setRows([]);
    setVisible(20);
    // Bound the UI wait, not the database transaction. Never close a shared connection
    // or treat a timeout as empty storage; discard its late result and offer a fresh read.
    timer.current = setTimeout(() => {
      if (generation.current !== request) return;
      generation.current += 1;
      timer.current = null;
      setState('failed');
    }, READ_WAIT_MS);
    try {
      const result = await load();
      if (generation.current !== request) return;
      setRows(result);
      setState('ready');
    } catch {
      if (generation.current === request) setState('failed');
    } finally {
      if (generation.current === request) clearReadTimer();
    }
  }, [load, clearReadTimer]);

  useEffect(() => {
    // Deletion fences invalidate cached text and pending reads, even if later cleanup fails.
    const unsubscribeClear = subscribeLocalDataClear(close);
    const unsubscribeSource = subscribeLocalSourceDeletion(close);
    const subscription = AppState.addEventListener('change', next => {
      active.current = next === 'active';
      if (!active.current) close();
      else refresh();
    });
    // Wait for confirmed foreground state; an unknown initial state is not permission to expose local text.
    if (AppState.currentState === 'active') {
      refresh();
    }
    return () => {
      clearReadTimer();
      generation.current += 1;
      subscription.remove();
      unsubscribeClear();
      unsubscribeSource();
    };
  }, [refresh, close, clearReadTimer]);

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
