import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import type { DailyReminderPreference } from '../dailyReminders/nativeDailyReminder';
import {
  dailyReminderPickerDate,
  formatDailyReminderTime,
} from '../dailyReminders/dailyReminderPresentation';
import { useDailyReminderSettings } from '../dailyReminders/useDailyReminderSettings';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { SettingsDailyReminderStatus } from './SettingsDailyReminderStatus';
import { SettingsDailyReminderTimePicker } from './SettingsDailyReminderTimePicker';

const MINIMUM_SWITCH_TOUCH_TARGET = 44;

/** Connects the opt-in to native scheduling and measures its switch target. */
export function SettingsDailyReminderSection() {
  const { refresh, save, state } = useDailyReminderSettings();
  const preference = state.pendingPreference ?? state.preference;
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerValue, setPickerValue] = useState(() => new Date());
  const [enableAfterPicker, setEnableAfterPicker] = useState(false);
  const [switchFrame, setSwitchFrame] = useState({ height: 0, width: 0 });
  const switchHorizontalHitSlop = Math.max(
    0,
    (MINIMUM_SWITCH_TOUCH_TARGET - switchFrame.width) / 2,
  );
  const switchVerticalHitSlop = Math.max(
    0,
    (MINIMUM_SWITCH_TOUCH_TARGET - switchFrame.height) / 2,
  );
  const isUnavailable = state.loading || state.loadError;
  const isBusy = isUnavailable || state.saving;

  function openPicker(enableWhenConfirmed = false) {
    setPickerValue(dailyReminderPickerDate(preference));
    setEnableAfterPicker(enableWhenConfirmed);
    setPickerVisible(true);
  }

  function closePicker() {
    setEnableAfterPicker(false);
    setPickerVisible(false);
  }

  function confirmPicker() {
    const next: DailyReminderPreference = {
      enabled: enableAfterPicker || preference?.enabled === true,
      hour: pickerValue.getHours(),
      minute: pickerValue.getMinutes(),
    };
    closePicker();
    save(next);
  }

  function toggleReminder(enabled: boolean) {
    if (enabled && preference == null) {
      // A time is not persisted until the person confirms it in the picker.
      openPicker(true);
      return;
    }
    if (preference == null) return;
    save({ ...preference, enabled });
  }

  function retry() {
    if (state.pendingPreference != null) {
      save(state.pendingPreference);
    } else if (state.preference?.enabled) {
      save(state.preference);
    } else {
      refresh();
    }
  }

  // Expand only short measured dimensions so the native switch target reaches 44 points.
  function measureSwitch(event: LayoutChangeEvent) {
    const { height, width } = event.nativeEvent.layout;
    setSwitchFrame(current =>
      current.height === height && current.width === width
        ? current
        : { height, width },
    );
  }

  return (
    <View style={styles.section} testID="settings-section-daily-reminders">
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {t('settings.dailyReminder.title')}
      </Text>
      <View style={styles.card} testID="settings-daily-reminder-card">
        <Text
          style={styles.description}
          testID="settings-daily-reminder-description"
        >
          {t('settings.dailyReminder.description')}
        </Text>
        <View
          style={styles.toggleRow}
          testID="settings-daily-reminder-toggle-row"
        >
          <View
            style={styles.toggleLabelTarget}
            testID="settings-daily-reminder-toggle-label-target"
          >
            <Text
              style={styles.toggleLabel}
              testID="settings-daily-reminder-toggle-label"
            >
              {t('settings.dailyReminder.enabled')}
            </Text>
          </View>
          <View
            style={styles.toggleControlTarget}
            testID="settings-daily-reminder-toggle-control"
          >
            <Switch
              accessibilityHint={t('settings.dailyReminder.toggleHint')}
              accessibilityLabel={t('settings.dailyReminder.enabled')}
              accessibilityRole="switch"
              disabled={isBusy}
              hitSlop={{
                bottom: switchVerticalHitSlop,
                left: switchHorizontalHitSlop,
                right: switchHorizontalHitSlop,
                top: switchVerticalHitSlop,
              }}
              onLayout={measureSwitch}
              onValueChange={toggleReminder}
              testID="settings-daily-reminder-switch"
              value={preference?.enabled ?? false}
            />
          </View>
        </View>
        <View style={styles.divider} />
        <Pressable
          accessibilityHint={t('settings.dailyReminder.timeHint')}
          accessibilityLabel={
            preference == null
              ? t('settings.dailyReminder.chooseTime')
              : t('settings.dailyReminder.changeTimeAccessibility', {
                  time: formatDailyReminderTime(
                    preference.hour,
                    preference.minute,
                  ),
                })
          }
          accessibilityRole="button"
          disabled={isBusy}
          onPress={() => openPicker()}
          style={({ pressed }) => [styles.timeRow, pressed && styles.pressed]}
          testID="settings-daily-reminder-time"
        >
          <Text style={styles.timeTitle}>
            {t('settings.dailyReminder.time')}
          </Text>
          <View style={styles.timeValueContainer}>
            <Text style={styles.timeValue}>
              {preference == null
                ? t('settings.dailyReminder.chooseTime')
                : formatDailyReminderTime(preference.hour, preference.minute)}
            </Text>
            {preference != null ? (
              <Text style={styles.changeTime}>
                {t('settings.dailyReminder.changeTime')}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <SettingsDailyReminderStatus
          onRetry={retry}
          preference={preference}
          state={state}
        />
      </View>

      <SettingsDailyReminderTimePicker
        onCancel={closePicker}
        onSave={confirmPicker}
        onValueChange={setPickerValue}
        enableWhenSaved={enableAfterPicker}
        value={pickerValue}
        visible={pickerVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: {
    color: appColors.secondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  description: {
    color: appColors.secondary,
    fontSize: 15,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 60,
    paddingHorizontal: 16,
  },
  toggleLabelTarget: { flex: 1, justifyContent: 'center', minHeight: 44 },
  toggleLabel: { color: appColors.text, fontSize: 17 },
  toggleControlTarget: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MINIMUM_SWITCH_TOUCH_TARGET,
    minWidth: MINIMUM_SWITCH_TOUCH_TARGET,
  },
  divider: {
    backgroundColor: appColors.border,
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  timeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.65 },
  timeTitle: { color: appColors.text, fontSize: 16 },
  timeValueContainer: { alignItems: 'flex-end', gap: 2, maxWidth: '55%' },
  timeValue: { color: appColors.primaryText, fontSize: 16 },
  changeTime: { color: appColors.secondary, fontSize: 13 },
});
