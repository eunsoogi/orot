import { Button, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
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
  return (
    <View style={styles.form}>
      <Text accessibilityRole="header" style={styles.formTitle}>
        {editing
          ? t('appointments.form.editTitle')
          : t('appointments.form.newTitle')}
      </Text>
      <TextInput
        accessibilityLabel={t('appointments.form.clinicLabel')}
        onChangeText={onClinicLabelChange}
        placeholder={t('appointments.form.clinicLabel')}
        style={styles.input}
        testID="appointment-clinic-input"
        value={clinicLabel}
      />
      <TextInput
        accessibilityLabel={t('appointments.form.dateLabel')}
        onChangeText={onDateChange}
        placeholder="YYYY-MM-DD"
        style={styles.input}
        testID="appointment-date-input"
        value={date}
      />
      <TextInput
        accessibilityLabel={t('appointments.form.timeLabel')}
        onChangeText={onTimeChange}
        placeholder="HH:MM"
        style={styles.input}
        testID="appointment-time-input"
        value={time}
      />
      <Text style={styles.hint}>{t('appointments.form.timezoneHint')}</Text>
      <TextInput
        accessibilityLabel={t('appointments.form.noteLabel')}
        onChangeText={onNoteChange}
        placeholder={t('appointments.form.noteLabel')}
        style={[styles.input, styles.note]}
        testID="appointment-note-input"
        value={note}
      />
      <Button
        disabled={saving}
        onPress={onSave}
        testID="appointment-save"
        title={
          saving
            ? t('appointments.actions.saving')
            : t('appointments.actions.save')
        }
      />
      <Button
        disabled={saving}
        onPress={onClose}
        testID="appointment-form-cancel"
        title={t('appointments.actions.close')}
      />
    </View>
  );
}
