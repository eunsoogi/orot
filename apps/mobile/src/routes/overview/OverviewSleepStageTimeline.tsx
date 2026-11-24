import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import {
  overviewSleepStages,
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
  core: appColors.primaryText,
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
  const rowHeight = 33 * Math.max(1, useWindowDimensions().fontScale);
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
  const caption = (value: number) => intervalTime.format(value);
  return (
    <View style={styles.timeline} testID="overview-sleep-stage-timeline">
      <View style={styles.content}>
        <View
          style={styles.labels}
          accessible={false}
          accessibilityElementsHidden
        >
          {shown.map(stage => (
            <View
              key={stage}
              style={[styles.labelRow, { minHeight: rowHeight }]}
            >
              <Text style={styles.label}>{t(labels[stage])}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.lanes, { height: shown.length * rowHeight }]}>
          {shown.map(stage => (
            <View
              key={stage}
              pointerEvents="none"
              style={[styles.guide, { top: rowFor(stage) + rowHeight - 6 }]}
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
  labels: { flexBasis: '33%', maxWidth: 100 },
  labelRow: { justifyContent: 'center' },
  label: { color: appColors.text, fontSize: 12, flexShrink: 1 },
  note: { color: appColors.secondary, fontSize: 12 },
  lanes: { flex: 1, minWidth: 0, position: 'relative' },
  guide: {
    position: 'absolute',
    width: '100%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: appColors.border,
  },
  interval: { position: 'absolute', height: 12, borderRadius: 4 },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
  },
});
