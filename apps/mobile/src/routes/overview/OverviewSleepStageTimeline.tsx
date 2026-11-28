import {
  StyleSheet,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';
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
// Each theme preserves the reference stage hues without using low-contrast pastel text on light cards.
const stagesByAppearance = {
  light: {
    awake: '#bc375d',
    rem: '#067c64',
    core: '#176dc7',
    deep: '#782bb7',
    unspecified: '#5e6875',
  },
  dark: {
    awake: '#ff638d',
    rem: '#58d8b9',
    core: '#55a4ff',
    deep: '#ad69ff',
    unspecified: '#a1acb8',
  },
} as const;
const stageMarkHeight = 13;

function fraction(value: number, episode: OverviewSleepEpisode): number {
  return ((value - episode.from) / (episode.to - episode.from)) * 100;
}

/** Absolute positions use elapsed instants, not wall clock fractions, so a DST
 * fold, empty gap, or short sample never stretches a neighboring stage. */
export function OverviewSleepStageTimeline({
  episode,
  timeZone,
  cardWidth,
}: {
  readonly episode?: OverviewSleepEpisode;
  readonly timeZone: string;
  readonly cardWidth: number | '100%';
}) {
  const { fontScale } = useWindowDimensions();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = stagesByAppearance[scheme];
  // Keep label and duration columns aligned; narrow or enlarged cards use two lines per stage.
  const stacked =
    fontScale > 1.2 || (typeof cardWidth === 'number' && cardWidth < 280);
  const rowHeight = Math.ceil((stacked ? 31 : 24) * Math.max(1, fontScale));
  if (!episode?.intervals.length)
    return (
      <Text style={styles.note}>{t('overview.sleepStagesUnavailable')}</Text>
    );
  const clockOptions = {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  } as const;
  const axisTime = new Intl.DateTimeFormat(undefined, clockOptions);
  // VoiceOver interval labels still disambiguate repeated local times at a DST fold.
  const intervalTime = new Intl.DateTimeFormat(undefined, {
    ...clockOptions,
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
    <View style={styles.content} testID="overview-sleep-stage-timeline">
      <Svg
        width="100%"
        height={shown.length * rowHeight}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
      >
        {shown.slice(0, -1).map(stage => {
          const y = rowFor(stage) + rowHeight - 0.5;
          return (
            <Line
              key={stage}
              x1={0}
              x2="100%"
              y1={y}
              y2={y}
              stroke={scheme === 'dark' ? '#666f7b' : '#949da8'}
              strokeWidth={1}
              strokeDasharray="1 3"
            />
          );
        })}
      </Svg>
      <View style={styles.labels}>
        {shown.map(stage => (
          <View
            key={stage}
            style={[
              styles.labelRow,
              !stacked && styles.labelRowInline,
              { height: rowHeight },
            ]}
          >
            <Text
              style={[
                styles.label,
                !stacked && styles.labelName,
                { color: colors[stage] },
              ]}
            >
              {t(labels[stage])}
            </Text>
            {stageMinutes.has(stage) && (
              <Text
                testID={`overview-sleep-duration-${stage}`}
                style={[styles.duration, !stacked && styles.labelDuration]}
              >
                {formatHealthDuration('sleep', stageMinutes.get(stage)!, 'min')}
              </Text>
            )}
          </View>
        ))}
      </View>
      {/* The axis shares the plot column, not the legend's leading inset. */}
      <View style={styles.plot} testID="overview-sleep-stage-plot">
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
                  top: rowFor(point.stage) + (rowHeight - stageMarkHeight) / 2,
                  left: `${fraction(point.start, episode)}%`,
                  width: `${fraction(point.end, episode) - fraction(point.start, episode)}%`,
                  backgroundColor: colors[point.stage],
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.times} testID="overview-sleep-stage-axis">
          <Text style={[styles.note, styles.endpoint]}>
            {axisTime.format(episode.from)}
          </Text>
          <Text style={[styles.note, styles.endpoint, styles.trailing]}>
            {axisTime.format(episode.to)}
          </Text>
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  content: { flexDirection: 'row', gap: 8, width: '100%' },
  plot: { flex: 1, minWidth: 0, gap: 6 },
  labels: { flexBasis: '46%', maxWidth: 220 },
  labelRow: { justifyContent: 'center' },
  labelRowInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    columnGap: 4,
  },
  label: { fontSize: 11, fontWeight: '600' },
  labelName: { flex: 1.05, minWidth: 0 },
  labelDuration: { flex: 1, minWidth: 0 },
  duration: {
    color: appColors.text,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  note: { color: appColors.secondary, fontSize: 11 },
  lanes: { position: 'relative', overflow: 'hidden' },
  connector: {
    position: 'absolute',
    width: 3,
    marginLeft: -1.5,
    opacity: 0.48,
  },
  interval: { position: 'absolute', height: stageMarkHeight, borderRadius: 5 },
  times: { flexDirection: 'row', gap: 4 },
  endpoint: { flex: 1, minWidth: 0, textAlign: 'left' },
  trailing: { textAlign: 'right' },
});
