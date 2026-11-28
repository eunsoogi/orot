import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { formatHealthDuration } from '../../i18n/healthDuration';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import {
  overviewSleepStages,
  sleepStageTransitions,
  type OverviewSleepEpisode,
  type OverviewSleepStage,
} from './overviewSleepEpisode';

const labels = {
  awake: 'healthSemantic.awake',
  rem: 'healthSemantic.remSleep',
  core: 'healthSemantic.coreSleep',
  deep: 'healthSemantic.deepSleep',
  unspecified: 'healthSemantic.unspecifiedSleep',
} as const;
const colors = {
  awake: appColors.pink,
  rem: appColors.green,
  core: appColors.primary,
  deep: appColors.purple,
  unspecified: appColors.secondary,
} as const;

function fraction(value: number, episode: OverviewSleepEpisode): number {
  return ((value - episode.from) / (episode.to - episode.from)) * 100;
}

/** Absolute positions use elapsed instants, not wall clock fractions, so a DST
 * fold, empty gap, or short sample never stretches a neighboring stage. */
export function OverviewSleepStageTimeline({
  episode,
  timeZone,
}: {
  readonly episode?: OverviewSleepEpisode;
  readonly timeZone: string;
}) {
  const rowHeight = 31 * Math.max(1, useWindowDimensions().fontScale);
  if (!episode?.intervals.length)
    return (
      <Text style={styles.note}>{t('overview.sleepStagesUnavailable')}</Text>
    );
  const intervalTime = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
  });
  const shown = overviewSleepStages.filter(
    stage =>
      stage !== 'unspecified' ||
      episode.intervals.some(point => point.stage === stage),
  );
  const rowFor = (stage: OverviewSleepStage) =>
    shown.indexOf(stage) * rowHeight;
  const stageMinutes = new Map<OverviewSleepStage, number>();
  for (const { stage, start, end } of episode.intervals)
    stageMinutes.set(
      stage,
      (stageMinutes.get(stage) ?? 0) + (end - start) / 60_000,
    );
  const transitions = sleepStageTransitions(episode);
  const caption = (value: number) => intervalTime.format(value);
  return (
    <View style={styles.timeline} testID="overview-sleep-stage-timeline">
      <View style={styles.content}>
        {shown.map(stage => (
          <View
            key={stage}
            pointerEvents="none"
            style={[styles.guide, { top: rowFor(stage) + rowHeight - 1 }]}
          />
        ))}
        <View style={styles.labels}>
          {shown.map(stage => (
            <View
              key={stage}
              style={[styles.labelRow, { minHeight: rowHeight }]}
            >
              <Text style={[styles.label, { color: colors[stage] }]}>
                {t(labels[stage])}
              </Text>
              {stageMinutes.has(stage) && (
                <Text
                  testID={`overview-sleep-duration-${stage}`}
                  style={styles.note}
                >
                  {formatHealthDuration(
                    'sleep',
                    stageMinutes.get(stage)!,
                    'min',
                  )}
                </Text>
              )}
            </View>
          ))}
        </View>
        <View style={[styles.lanes, { height: shown.length * rowHeight }]}>
          {transitions.map(({ from, to, at }) => (
            <View
              key={at}
              pointerEvents="none"
              testID="overview-sleep-stage-connector"
              style={[
                styles.connector,
                {
                  left: `${fraction(at, episode)}%`,
                  top: Math.min(rowFor(from), rowFor(to)) + rowHeight / 2,
                  height: Math.abs(rowFor(from) - rowFor(to)),
                  backgroundColor: colors[to],
                },
              ]}
            />
          ))}
          {episode.intervals.map(point => (
            <View
              key={[point.stage, point.start, point.end].join(':')}
              accessible
              accessibilityLabel={t('overview.sleepStageInterval', {
                stage: t(labels[point.stage]),
                start: caption(point.start),
                end: caption(point.end),
              })}
              testID={`overview-sleep-interval-${point.stage}`}
              style={[
                styles.interval,
                {
                  top: rowFor(point.stage) + (rowHeight - 12) / 2,
                  left: `${fraction(point.start, episode)}%`,
                  width: `${fraction(point.end, episode) - fraction(point.start, episode)}%`,
                  backgroundColor: colors[point.stage],
                },
              ]}
            />
          ))}
        </View>
      </View>
      <View style={styles.times}>
        <Text style={styles.note}>{caption(episode.from)}</Text>
        <Text style={styles.note}>{caption(episode.to)}</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  timeline: { gap: 6, width: '100%' },
  content: { flexDirection: 'row', gap: 8 },
  labels: { flexBasis: '36%', maxWidth: 190 },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 6,
    alignItems: 'baseline',
    alignContent: 'center',
  },
  label: { fontSize: 12, flexShrink: 1, fontWeight: '600' },
  note: { color: appColors.secondary, fontSize: 12 },
  lanes: { flex: 1, minWidth: 0, position: 'relative' },
  guide: {
    position: 'absolute',
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    borderStyle: 'dotted',
  },
  connector: {
    position: 'absolute',
    width: 3,
    marginLeft: -1.5,
    opacity: 0.48,
  },
  interval: { position: 'absolute', height: 12, borderRadius: 4 },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
  },
});
