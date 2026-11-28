import { StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import { AppSymbol } from './AppSymbol';
import { appColors } from './appColors';

export const upcomingVisitSectionStyle = { gap: 8, minWidth: 0 } as const;

export function UpcomingVisitHeading({
  label,
  testID,
}: {
  readonly label: string;
  readonly testID?: string;
}) {
  return (
    <Text accessibilityRole="header" style={styles.label} testID={testID}>
      {label}
    </Text>
  );
}

function visitCountdown(startsAt: string, now = new Date()) {
  // Compare device calendar days, not elapsed hours across a DST change.
  const day = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((day(new Date(startsAt)) - day(now)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  return days === 0 ? 'D-day' : `D${days > 0 ? '-' : '+'}${Math.abs(days)}`;
}

/** Shared visual hierarchy only. Each owning route supplies its authorized date text and actions. */
export function UpcomingVisitDetails({
  title,
  time,
  startsAt,
  testIDs,
}: {
  readonly title: string;
  readonly time: string;
  readonly startsAt: string;
  readonly testIDs: {
    readonly details?: string;
    readonly titleRow: string;
    readonly timeRow: string;
    readonly title: string;
    readonly countdown: string;
    readonly time: string;
  };
}) {
  const countdown = visitCountdown(startsAt);
  return (
    <View style={styles.details} testID={testIDs.details}>
      <View style={styles.titleRow} testID={testIDs.titleRow}>
        {/* Let a long title wrap without shifting the fixed countdown below it. */}
        <Text style={styles.title} testID={testIDs.title}>
          {title}
        </Text>
        {countdown ? (
          <Text style={styles.countdown} testID={testIDs.countdown}>
            {countdown}
          </Text>
        ) : null}
      </View>
      <View style={styles.timeRow} testID={testIDs.timeRow}>
        <AppSymbol name="calendar" size={17} color={appColors.secondary} />
        <Text style={styles.time} testID={testIDs.time}>
          {time}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: appColors.text,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: appColors.text, flex: 1, fontSize: 28, fontWeight: '700' },
  countdown: {
    flexShrink: 0,
    color: appColors.primaryText,
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 13,
    fontWeight: '600',
  },
  details: { gap: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { color: appColors.secondary, flexShrink: 1, fontSize: 16 },
});
