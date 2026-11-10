import DateTimePicker from '@react-native-community/datetimepicker';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

interface SettingsDailyReminderTimePickerProps {
  readonly onCancel: () => void;
  readonly enableWhenSaved: boolean;
  readonly onSave: () => void;
  readonly onValueChange: (value: Date) => void;
  readonly value: Date;
  readonly visible: boolean;
}

/** Keeps picker edits temporary until the person explicitly confirms the time. */
export function SettingsDailyReminderTimePicker({
  onCancel,
  onSave,
  onValueChange,
  enableWhenSaved,
  value,
  visible,
}: SettingsDailyReminderTimePickerProps) {
  return (
    <Modal
      animationType="slide"
      onDismiss={onCancel}
      onRequestClose={onCancel}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={styles.sheet} testID="settings-daily-reminder-picker-sheet">
        <Text accessibilityRole="header" style={styles.title}>
          {t('settings.dailyReminder.pickerTitle')}
        </Text>
        <DateTimePicker
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale={Platform.OS === 'ios' ? 'ko-KR' : undefined}
          mode="time"
          onChange={(event, selectedDate) => {
            if (event.type === 'dismissed') {
              onCancel();
            } else if (selectedDate != null) {
              onValueChange(selectedDate);
            }
          }}
          testID="settings-daily-reminder-native-time-picker"
          value={value}
        />
        <View style={styles.actions}>
          <AppButton
            onPress={onCancel}
            size="compact"
            title={t('settings.dailyReminder.cancel')}
            variant="cancel"
            testID="settings-daily-reminder-cancel"
          />
          <AppButton
            onPress={onSave}
            size="compact"
            title={
              enableWhenSaved
                ? t('settings.dailyReminder.enableWithTime')
                : t('settings.dailyReminder.saveTime')
            }
            testID="settings-daily-reminder-save-time"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: appColors.background,
    flexGrow: 1,
    gap: 20,
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: appColors.text, fontSize: 24, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-end',
  },
});
