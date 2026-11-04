import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppButton } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { formatDateTime, formatNumber, t } from '../../i18n';
import type { HomeMetric } from './metricSelection';
import type { HomeMetricProjection } from './metricProjection';
import { HomeMetricSelectionEditor } from './HomeMetricSelectionEditor';
import { useHomeMetrics } from './useHomeMetrics';
import { homeMetricStyles as styles } from './homeMetricStyles';
import { HomeRecentHealthChange } from './HomeRecentHealthChange';

const title = (metric: HomeMetric) =>
  ({
    sleep: t('home.metricSleep'),
    heartRate: t('home.metricHeartRate'),
    bodyMass: t('home.metricBodyMass'),
    steps: t('home.metricSteps'),
  })[metric];
const value = (number: number, unit: string) =>
  `${formatNumber(number, { maximumFractionDigits: 1 })} ${unit}`;

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
  const statistic =
    metric.metric === 'heartRate'
      ? t('home.dailyMean')
      : metric.metric === 'bodyMass'
        ? t('home.dailyLatest')
        : t('home.dailySum');
  const summary = metric.days
    .map(
      day =>
        `${day.date}: ${day.value === null ? t('home.metricEmpty') : value(day.value, metric.unit)}${day.partial ? `, ${t('home.partialToday')}` : ''}`,
    )
    .join('; ');
  return (
    <View
      style={[styles.card, styles.gridCard]}
      testID={`home-metric-${metric.metric}`}
      accessibilityLabel={`${title(metric.metric)}. ${metric.latest.date} ${statistic}: ${value(metric.latest.value, metric.unit)}. ${metric.measuredAt ? formatDateTime(new Date(metric.measuredAt)) : t('home.measurementUnknown')}. ${metric.source}. ${metric.timeZone}. ${summary}`}
      accessible
    >
      <View style={styles.metricHeading}>
        <View style={styles.metricIcon}>
          <AppSymbol name={symbol} color={accent} />
        </View>
        <Text style={styles.cardTitle}>{title(metric.metric)}</Text>
      </View>
      <Text style={styles.number}>
        {value(metric.latest.value, metric.unit)}
      </Text>
      <Text style={styles.detail}>
        {metric.latest.date} · {statistic}
      </Text>
      <Text style={styles.detail}>
        {metric.measuredAt
          ? formatDateTime(new Date(metric.measuredAt))
          : t('home.measurementUnknown')}{' '}
        · {metric.source} · {metric.timeZone}
      </Text>
      <Text style={styles.detail}>0 – {value(maximum, metric.unit)}</Text>
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

/** Displays calendar-day aggregates and retains metric edits until save succeeds. */
export function HomeMetrics() {
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
        <HomeMetricSelectionEditor
          canSave={draft.length >= 2 && draft.length <= 4}
          onCancel={() => setDraft(null)}
          onSave={save}
          onToggle={toggle}
          saveError={saveError}
          saving={saving}
          selection={draft}
          title={title}
        />
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
            <HomeRecentHealthChange
              key={metric.metric}
              metric={metric}
              title={title(metric.metric)}
              formatValue={value}
            />
          ))
        ) : (
          <Text>{t('home.noChanges')}</Text>
        ))}
    </View>
  );
}
