import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { NativeGlassBackdrop } from '../layout/NativeGlassBackdrop';
import { appColors } from '../layout/appColors';

interface ScheduleAgendaSelectActionProps {
  readonly testID: string;
  readonly title: string;
  readonly time: string;
  readonly draftSelected: boolean;
  readonly draftActive: boolean;
  readonly savedVisit: boolean;
  readonly disabled: boolean;
  readonly onPress?: () => void;
}

/** Shares the Records glass surface; the saved-only snapshot stays a status, not a tappable candidate. */
export function ScheduleAgendaSelectAction({
  testID,
  title,
  time,
  draftSelected,
  draftActive,
  savedVisit,
  disabled,
  onPress,
}: ScheduleAgendaSelectActionProps) {
  // A different draft does not replace the saved visit before confirmation.
  const savedBesideDraft = savedVisit && draftActive && !draftSelected;
  const selected = draftSelected || (savedVisit && !draftActive);
  const label = t(
    savedBesideDraft
      ? 'calendar.nextVisit'
      : selected
        ? 'calendar.selectedEvent'
        : 'calendar.selectEvent',
  );
  const accessibleLabel = [
    title,
    time,
    savedVisit && !savedBesideDraft ? t('calendar.nextVisit') : null,
    label,
  ]
    .filter(Boolean)
    .join(', ');
  const content = (
    <>
      <NativeGlassBackdrop testID={`${testID}-glass`} />
      <View style={styles.content}>
        {selected || savedVisit ? (
          <AppSymbol name="checkmark" size={13} color={appColors.primaryText} />
        ) : null}
        <Text style={styles.label}>{label}</Text>
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View
        accessible
        accessibilityLabel={accessibleLabel}
        style={styles.action}
        testID={testID}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={accessibleLabel}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        (pressed || disabled) && styles.dimmed,
      ]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'center',
    borderRadius: 28,
    justifyContent: 'center',
    maxWidth: '100%',
    minHeight: 44,
    minWidth: 44,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: {
    color: appColors.primaryText,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  dimmed: { opacity: 0.55 },
});
