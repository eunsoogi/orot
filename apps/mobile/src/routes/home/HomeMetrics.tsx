import { useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppButton } from '../../layout/AppButton';
import { t } from '../../i18n';
import { homeMetrics, type HomeMetric } from './metricSelection';
import { useHomeMetrics } from './useHomeMetrics';
import { homeMetricStyles as styles } from './homeMetricStyles';
import {
  HomeMetricCard,
  homeMetricTitle as title,
  homeMetricValue as value,
} from './HomeMetricCard';
import { resolveHomeMetricGridLayout } from './homeMetricLayout';

/** Displays observed calendar-day aggregates, with gaps and sample semantics visible. */
export function HomeMetrics() {
  const data = useHomeMetrics();
  const { fontScale } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const [draft, setDraft] = useState<readonly HomeMetric[] | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const toggle = (metric: HomeMetric) =>
    setDraft(current =>
      current?.includes(metric)
        ? current.filter(item => item !== metric)
        : [...(current ?? []), metric],
    );
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await data.save(draft ?? []);
      setDraft(null);
      setSaveError(false);
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const comparisons = data.selection
    .flatMap(metric =>
      data.metrics[metric]?.comparison ? [data.metrics[metric]!] : [],
    )
    .slice(0, 2);
  const gridLayout = resolveHomeMetricGridLayout(
    gridWidth,
    data.selection.length,
    fontScale,
  );
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('home.healthOverview')}
        </Text>
        <Pressable
          accessibilityRole="button"
          testID="home-metrics-edit"
          style={styles.edit}
          disabled={data.state !== 'ready' || saving}
          accessibilityState={{ disabled: data.state !== 'ready' || saving }}
          onPress={() => {
            setDraft(data.selection);
            setSaveError(false);
          }}
        >
          <Text>{t('home.metricEdit')}</Text>
        </Pressable>
      </View>
      {data.state === 'loading' ? (
        <Text>{t('home.preparationLoading')}</Text>
      ) : data.state === 'failed' ? (
        <>
          <Text accessibilityRole="alert">{t('home.metricError')}</Text>
          <AppButton title={t('appointments.retry')} onPress={data.retry} />
        </>
      ) : (
        <View
          style={styles.grid}
          testID="home-metric-grid"
          onLayout={event => {
            const { width } = event.nativeEvent.layout;
            setGridWidth(current => (current === width ? current : width));
          }}
        >
          {data.selection.map(metric =>
            data.metrics[metric] ? (
              <HomeMetricCard
                key={metric}
                metric={data.metrics[metric]!}
                width={gridLayout.cardWidth}
              />
            ) : (
              <View
                key={metric}
                style={[
                  styles.card,
                  styles.gridCard,
                  { width: gridLayout.cardWidth },
                ]}
              >
                <Text style={styles.cardTitle}>{title(metric)}</Text>
                <Text>
                  {metric !== 'sleep' && data.quantityTruncated
                    ? t('home.metricTruncated')
                    : t('home.metricWindowEmpty')}
                </Text>
              </View>
            ),
          )}
        </View>
      )}
      {draft && (
        <View style={styles.card}>
          <Text>{t('home.metricChoose')}</Text>
          {homeMetrics.map(metric => (
            <Pressable
              key={metric}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: draft.includes(metric),
                disabled: saving,
              }}
              disabled={saving}
              onPress={() => toggle(metric)}
            >
              <Text>
                {draft.includes(metric) ? '✓ ' : '○ '}
                {title(metric)}
              </Text>
            </Pressable>
          ))}
          {saveError && (
            <Text accessibilityRole="alert">{t('home.metricSaveError')}</Text>
          )}
          <AppButton
            title={t('home.metricSave')}
            variant="text"
            disabled={saving || draft.length < 2 || draft.length > 4}
            busy={saving}
            onPress={save}
          />
          <AppButton
            title={t('home.metricCancel')}
            variant="cancel"
            disabled={saving}
            onPress={() => setDraft(null)}
          />
        </View>
      )}
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="home-recent-changes"
      >
        {t('home.recentChanges')}
      </Text>
      {data.state === 'ready' &&
        (comparisons.length ? (
          comparisons.map(metric => (
            <Text key={metric.metric} style={styles.card}>
              {title(metric.metric)} · {t('home.recordedDayMean')} ·{' '}
              {metric.comparison!.previousDates[0]}–
              {metric.comparison!.previousDates.at(-1)}:{' '}
              {value(metric.comparison!.previous, metric.unit)} (
              {metric.comparison!.previousCoverage}/7) →{' '}
              {metric.comparison!.recentDates[0]}–
              {metric.comparison!.recentDates.at(-1)}:{' '}
              {value(metric.comparison!.recent, metric.unit)} (
              {metric.comparison!.recentCoverage}/7) · {metric.source} ·{' '}
              {metric.timeZone}
            </Text>
          ))
        ) : (
          <Text>{t('home.noChanges')}</Text>
        ))}
    </View>
  );
}
