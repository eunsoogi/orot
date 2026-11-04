import { useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppButton } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { formatDateTime, t } from '../../i18n';
import { homeMetrics, type HomeMetric } from './metricSelection';
import {
  formatHomeMetricDaySummary,
  formatHomeMetricValue,
  homeMetricStatistic,
  homeMetricTitle,
} from './metricFormatting';
import type { HomeMetricProjection } from './metricProjection';
import { useHomeMetrics } from './useHomeMetrics';
import { homeMetricStyles as styles } from './homeMetricStyles';

/** Keeps provenance and time-zone metadata in the projection without exposing it on the overview. */
function MetricCard({ metric }: { readonly metric: HomeMetricProjection }) {
  const accent =
    metric.metric === 'sleep'
      ? appColors.purple
      : metric.metric === 'heartRate'
        ? appColors.pink
        : metric.metric === 'bodyMass'
          ? appColors.primaryText
          : appColors.green;
  const symbol = {
    sleep: 'moon',
    heartRate: 'heart',
    bodyMass: 'scalemass',
    steps: 'figure.walk',
  }[metric.metric];
  const maximum = Math.max(1, ...metric.days.map(day => day.value ?? 0));
  const statistic = homeMetricStatistic(metric.metric);
  const latestValue = formatHomeMetricValue(
    metric.metric,
    metric.latest.value,
    metric.unit,
  );
  const summary = formatHomeMetricDaySummary(metric);
  return (
    <View
      style={[styles.card, styles.gridCard]}
      testID={`home-metric-${metric.metric}`}
      accessibilityLabel={`${homeMetricTitle(metric.metric)}. ${metric.latest.date} ${statistic}: ${latestValue}. ${metric.measuredAt ? formatDateTime(new Date(metric.measuredAt)) : t('home.measurementUnknown')}. ${summary}`}
      accessible
    >
      <View style={styles.metricHeading}>
        <View style={styles.metricIcon}>
          <AppSymbol name={symbol} color={accent} />
        </View>
        <Text style={styles.cardTitle}>{homeMetricTitle(metric.metric)}</Text>
      </View>
      <Text style={styles.number}>{latestValue}</Text>
      <Text style={styles.detail}>
        {metric.latest.date} · {statistic}
      </Text>
      <Text style={styles.detail}>
        {metric.measuredAt
          ? formatDateTime(new Date(metric.measuredAt))
          : t('home.measurementUnknown')}
      </Text>
      <Text style={styles.detail}>
        0 – {formatHomeMetricValue(metric.metric, maximum, metric.unit)}
      </Text>
      <View style={styles.chart}>
        {metric.days.map(day => (
          <View key={day.date} style={styles.column}>
            <View style={styles.barSpace}>
              {day.value !== null && (
                <View
                  style={[
                    styles.bar,
                    { backgroundColor: accent },
                    { height: `${(day.value / maximum) * 100}%` },
                  ]}
                />
              )}
            </View>
            <Text style={styles.date}>
              {day.date.slice(5).replace('-', '/')}
            </Text>
          </View>
        ))}
      </View>
      {metric.days.at(-1)?.partial && (
        <Text style={styles.detail}>{t('home.partialToday')}</Text>
      )}
    </View>
  );
}

/** Displays observed calendar-day aggregates, with gaps and sample semantics visible. */
export function HomeMetrics({ children }: { readonly children: ReactNode }) {
  const data = useHomeMetrics();
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
        <View style={styles.grid}>
          {data.selection.map(metric =>
            data.metrics[metric] ? (
              <MetricCard key={metric} metric={data.metrics[metric]!} />
            ) : (
              <View key={metric} style={[styles.card, styles.gridCard]}>
                <Text style={styles.cardTitle}>{homeMetricTitle(metric)}</Text>
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
                {homeMetricTitle(metric)}
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
      {children}
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
              {homeMetricTitle(metric.metric)} · {t('home.recordedDayMean')} ·{' '}
              {metric.comparison!.previousDates[0]}–
              {metric.comparison!.previousDates.at(-1)}:{' '}
              {formatHomeMetricValue(
                metric.metric,
                metric.comparison!.previous,
                metric.unit,
              )}{' '}
              ({metric.comparison!.previousCoverage}/7) →{' '}
              {metric.comparison!.recentDates[0]}–
              {metric.comparison!.recentDates.at(-1)}:{' '}
              {formatHomeMetricValue(
                metric.metric,
                metric.comparison!.recent,
                metric.unit,
              )}{' '}
              ({metric.comparison!.recentCoverage}/7)
            </Text>
          ))
        ) : (
          <Text>{t('home.noChanges')}</Text>
        ))}
    </View>
  );
}
