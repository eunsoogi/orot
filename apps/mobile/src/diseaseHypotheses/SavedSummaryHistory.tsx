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
}: {
  readonly history: SymptomSummaryHistory;
  readonly current?: DiseaseHypothesisAnalysis['savedSummary'];
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly onRestore: (value: DiseaseHypothesisAnalysis) => void;
}) {
  const [rows, setRows] = useState<readonly SavedSummaryListItem[]>([]);
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
      const result = await history.read(id);
      // Back may remove this history scene while encrypted storage is still reading.
      if (!mounted.current) return;
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
  const hasDock = useNavigationRouteActions([
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
      {current?.status === 'saved'
        ? current.contentReviewIssues?.map(issue => (
            <AppText
              key={issue}
              accessibilityRole="alert"
              testID={`summary-content-review-${issue}`}
            >
              {issue === 'prescription'
                ? t('summaryHistory.reviewPrescription')
                : issue === 'sleep_count'
                  ? t('summaryHistory.reviewSleepCount')
                  : issue === 'sleep_duration'
                    ? t('summaryHistory.reviewSleepDuration')
                    : t('summaryHistory.reviewSteps')}
            </AppText>
          ))
        : null}
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
          {rows.map(row => (
            <View key={row.id}>
              <AppButton
                key={row.id}
                variant="secondary"
                title={`${new Date(row.createdAt).toLocaleString('ko-KR')} · ${row.modelName}`}
                disabled={disabled || busy || row.inputLineage === 'unknown'}
                onPress={() => {
                  read(row.id);
                }}
              />
              {row.inputLineage === 'unknown' ? (
                <AppText>{t('summaryHistory.unknownLineage')}</AppText>
              ) : null}
            </View>
          ))}
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
