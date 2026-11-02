import { TextInput, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import styles from './appointmentsStyles';

interface AppointmentFormProps {
  editing: boolean;
  clinicLabel: string;
  date: string;
  time: string;
  note: string;
  saving: boolean;
  onClinicLabelChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/** The action variants clarify save versus close without changing form ownership. */
export default function AppointmentForm({
  editing,
  clinicLabel,
  date,
  time,
  note,
  saving,
  onClinicLabelChange,
  onDateChange,
  onTimeChange,
  onNoteChange,
  onSave,
  onClose,
}: AppointmentFormProps) {
  const saveLabel = saving
    ? t('appointments.actions.saving')
    : t('appointments.actions.save');
  const closeLabel = t('appointments.actions.close');
  const hasDock = useNavigationRouteActions([
    {
      id: 'save-appointment',
      label: saveLabel,
      accessibilityLabel: saveLabel,
      testID: 'appointment-save',
      busy: saving,
      systemImageName: 'checkmark',
      disabled: saving,
      onPress: onSave,
    },
    {
      id: 'close-appointment',
      label: closeLabel,
      accessibilityLabel: closeLabel,
      testID: 'appointment-form-cancel',
      systemImageName: 'xmark',
      disabled: saving,
      onPress: onClose,
    },
  ]);
  return (
    // Apply the reading-width cap inside the screen's measured content region.
    <View style={styles.form} testID="appointment-form">
      <Text accessibilityRole="header" style={styles.formTitle}>
        {editing
          ? t('appointments.form.editTitle')
          : t('appointments.form.newTitle')}
      </Text>
      <Text style={styles.message} testID="appointment-form-explanation">
        {t('appointments.description')}
      </Text>
      <TextInput
        accessibilityLabel={t('appointments.form.clinicLabel')}
        onChangeText={onClinicLabelChange}
        placeholder={t('appointments.form.clinicLabel')}
        placeholderTextColor={appColors.secondary}
        style={styles.input}
        testID="appointment-clinic-input"
        value={clinicLabel}
      />
      <TextInput
        accessibilityLabel={t('appointments.form.dateLabel')}
        onChangeText={onDateChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={appColors.secondary}
        style={styles.input}
        testID="appointment-date-input"
        value={date}
      />
      <TextInput
        accessibilityLabel={t('appointments.form.timeLabel')}
        onChangeText={onTimeChange}
        placeholder="HH:MM"
        placeholderTextColor={appColors.secondary}
        style={styles.input}
        testID="appointment-time-input"
        value={time}
      />
      <Text style={styles.hint}>{t('appointments.form.timezoneHint')}</Text>
      <TextInput
        accessibilityLabel={t('appointments.form.noteLabel')}
        onChangeText={onNoteChange}
        placeholder={t('appointments.form.noteLabel')}
        placeholderTextColor={appColors.secondary}
        style={[styles.input, styles.note]}
        testID="appointment-note-input"
        value={note}
      />
      {!hasDock ? (
        <Button
          busy={saving}
          disabled={saving}
          onPress={onSave}
          testID="appointment-save"
          title={
            saving
              ? t('appointments.actions.saving')
              : t('appointments.actions.save')
          }
        />
      ) : null}
      {!hasDock ? (
        <Button
          size="compact"
          disabled={saving}
          onPress={onClose}
          testID="appointment-form-cancel"
          title={t('appointments.actions.close')}
          variant="cancel"
        />
      ) : null}
    </View>
  );
}
