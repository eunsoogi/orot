import { SavedSummaryReviewWarnings } from './SavedSummaryReviewWarnings';
import { SavedSummaryHistoryRows } from './SavedSummaryHistoryRows';
import { SavedSummaryUnavailable } from './SavedSummaryUnavailable';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import type { DiseaseHypothesisAnalysis } from './types';
import type {
  SavedSummaryListItem,
  SymptomSummaryHistory,
} from './savedSummaries';

const styles = StyleSheet.create({
  container: { gap: 8 },
});

/** History reads only ten metadata rows at a time; opening a row loads one saved result without AI calls. */
export function SavedSummaryHistory({
  history,
  current,
  disabled,
  expanded,
  onRestore,
  onRegenerate,
}: {
  readonly onRegenerate?: () => void;
  readonly history: SymptomSummaryHistory;
  readonly current?: DiseaseHypothesisAnalysis['savedSummary'];
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly onRestore: (value: DiseaseHypothesisAnalysis) => void;
}) {
  const [rows, setRows] = useState<readonly SavedSummaryListItem[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const revision = current?.status === 'saved' ? current.id : undefined;
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoading(true);
    history
      .list()
      .then(page => {
        if (!active) return;
        setRows(page);
        setHasMore(page.length === 10);
        setError(false);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [history, revision, reload, expanded]);
  async function read(id: string) {
    if (busy || disabled) return;
    setBusy(true);
    setError(false);
    try {
      const status = history.readStatus ? await history.readStatus(id) : null;
      if (!mounted.current) return;
      if (status && 'status' in status) {
        setUnavailable(true);
        return;
      }
      const result = history.readStatus
        ? status?.analysis
        : await history.read(id);
      // Back may remove this history scene while encrypted storage is still reading.
      if (!mounted.current) return;
      setUnavailable(false);
      if (!result) throw new Error('Saved summary unavailable.');
      onRestore(result);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function retrySave() {
    setBusy(true);
    try {
      const result = await history.retrySave?.();
      if (result) onRestore(result);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const quarantined = unavailable || rows.some(row => row.unavailableReason);
  const hasDock = useNavigationRouteActions([
    ...(quarantined && onRegenerate
      ? [
          {
            id: 'regenerate-summary',
            label: t('summaryHistory.regenerate'),
            accessibilityLabel: t('summaryHistory.regenerate'),
            testID: 'summary-period-regenerate',
            systemImageName: 'arrow.clockwise',
            disabled: disabled || busy,
            onPress: onRegenerate,
          },
        ]
      : []),
    ...(current?.status === 'failed' || current?.status === 'source_unavailable'
      ? [
          {
            id: 'retry-summary-save',
            label: t('summaryHistory.retrySave'),
            accessibilityLabel: t('summaryHistory.retrySave'),
            testID: 'symptom-summary-save-retry',
            systemImageName: 'arrow.clockwise',
            disabled: disabled || busy,
            busy,
            onPress: retrySave,
          },
        ]
      : []),
    ...(error
      ? [
          {
            id: 'reload-summary-history',
            label: t('summaryHistory.reload'),
            accessibilityLabel: t('summaryHistory.reload'),
            testID: 'symptom-summary-reload',
            systemImageName: 'arrow.clockwise',
            disabled: disabled || busy,
            onPress: () => setReload(value => value + 1),
          },
        ]
      : []),
  ]);
  // A hidden history panel must not introduce another empty flex gap in the summary form.
  if (!current && !expanded && !error) return null;
  return (
    <View style={styles.container} testID="symptom-summary-history">
      {quarantined ? (
        <SavedSummaryUnavailable
          disabled={disabled || busy}
          onRegenerate={hasDock ? undefined : onRegenerate}
        />
      ) : null}
      {current?.status === 'saved' ? (
        <AppText testID="symptom-summary-saved">
          {t('summaryHistory.saved', {
            date: new Date(current.createdAt).toLocaleString('ko-KR'),
            model: current.modelName,
          })}
        </AppText>
      ) : null}
      {current?.status === 'saved' && current.sourceChanged ? (
        <AppText accessibilityRole="alert">
          {t('summaryHistory.sourceChanged')}
        </AppText>
      ) : null}
      <SavedSummaryReviewWarnings current={current} />
      {current?.status === 'failed' ||
      current?.status === 'source_unavailable' ? (
        <>
          <AppText accessibilityRole="alert">
            {current.status === 'source_unavailable'
              ? t('summaryHistory.sourceUnavailable')
              : t('summaryHistory.saveFailed')}
          </AppText>
          {!hasDock ? (
            <AppButton
              title={t('summaryHistory.retrySave')}
              variant="secondary"
              disabled={disabled || busy}
              onPress={retrySave}
            />
          ) : null}
        </>
      ) : null}
      {error ? (
        <>
          <AppText accessibilityRole="alert">
            {t('summaryHistory.loadFailed')}
          </AppText>
          {!hasDock ? (
            <AppButton
              title={t('summaryHistory.reload')}
              variant="secondary"
              disabled={disabled || busy}
              onPress={() => setReload(value => value + 1)}
            />
          ) : null}
        </>
      ) : null}
      {expanded ? (
        <>
          {loading ? <AppText>{t('summaryHistory.loading')}</AppText> : null}
          {rows.length === 0 && !error && !loading ? (
            <AppText>{t('summaryHistory.empty')}</AppText>
          ) : null}
          <SavedSummaryHistoryRows
            rows={rows}
            disabled={disabled || busy}
            onRead={read}
          />
          {hasMore ? (
            <AppButton
              title={t('summaryHistory.more')}
              variant="secondary"
              disabled={busy || disabled}
              onPress={async () => {
                setBusy(true);
                try {
                  const next = await history.list(rows[rows.length - 1]?.id);
                  setRows(items => [...items, ...next]);
                  setHasMore(next.length === 10);
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
