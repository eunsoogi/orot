import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, Text, View } from 'react-native';
import TextInput from './SymptomTextInput';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { toLocalSymptomDateTime, toSymptomTimestamp } from './dateTime';
import styles from './SymptomForm.styles';
import { symptomDateTimeControlLabels } from './symptomDateTimeControlLabels';

/** Native selection retains its instant; manual entry uses strict device-local calendar validation. */
export default function SymptomDateTimeFields({
  kind,
  date,
  time,
  setDate,
  setTime,
  onSelectInstant,
  accessoryIDs,
  initialInstant,
  onPickerOpenChange,
}: {
  readonly kind: 'onset' | 'resolved';
  readonly onPickerOpenChange: (open: boolean) => void;
  readonly initialInstant: string | null;
  readonly date: string;
  readonly time: string;
  readonly setDate: (value: string) => void;
  readonly setTime: (value: string) => void;
  readonly onSelectInstant: (value: string | null) => void;
  readonly accessoryIDs: { date?: string; time?: string };
}) {
  const [manual, setManual] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [selectedInstant, setSelectedInstant] = useState<string | null>(
    initialInstant,
  );
  const [pendingValue, setPendingValue] = useState<Date | null>(null);
  const timestamp = toSymptomTimestamp(date, time);
  const value = new Date(selectedInstant ?? timestamp ?? Date.now());
  const labels = symptomDateTimeControlLabels(date, time);
  const prefix = `symptom-${kind}`;
  return (
    <View style={styles.section}>
      <Text style={styles.fieldLabel}>
        {t(
          kind === 'onset'
            ? 'symptoms.journal.form.onset.title'
            : 'symptoms.journal.form.resolved.title',
        )}
      </Text>
      <View style={styles.row}>
        <View style={styles.halfInput}>
          <AppButton
            title={labels.date}
            onPress={() => {
              setPendingValue(value);
              setPickerMode('date');
              onPickerOpenChange(true);
            }}
            accessibilityLabel={`${t(kind === 'onset' ? 'symptoms.journal.form.onset.date' : 'symptoms.journal.form.resolved.date')}: ${date || t('symptoms.journal.form.chooseDate')}`}
            testID={`${prefix}-choose-date`}
            variant="secondary"
          />
        </View>
        <View style={styles.halfInput}>
          <AppButton
            title={labels.time}
            onPress={() => {
              setPendingValue(value);
              setPickerMode('time');
              onPickerOpenChange(true);
            }}
            accessibilityLabel={`${t(kind === 'onset' ? 'symptoms.journal.form.onset.time' : 'symptoms.journal.form.resolved.time')}: ${time || t('symptoms.journal.form.chooseTime')}`}
            testID={`${prefix}-choose-time`}
            variant="secondary"
          />
        </View>
      </View>
      {pickerMode ? (
        <>
          <DateTimePicker
            value={pendingValue ?? value}
            mode={pickerMode}
            display="spinner"
            locale="ko-KR"
            onDismiss={() => {
              setPickerMode(null);
              onPickerOpenChange(false);
            }}
            testID={`${prefix}-picker`}
            onValueChange={(_event, next) => {
              setPendingValue(next);
            }}
          />
          <Button
            title={t('symptoms.journal.keyboard.done')}
            onPress={() => {
              const next = pendingValue ?? value;
              const local = toLocalSymptomDateTime(next.toISOString());
              setSelectedInstant(next.toISOString());
              setDate(local.date);
              setTime(local.time);
              onSelectInstant(next.toISOString());
              setPickerMode(null);
              onPickerOpenChange(false);
            }}
            testID={`${prefix}-picker-done`}
          />
          <Button
            title={t('symptoms.journal.form.pickerCancel')}
            onPress={() => {
              setPickerMode(null);
              onPickerOpenChange(false);
            }}
            testID={`${prefix}-picker-cancel`}
          />
        </>
      ) : null}
      <Button
        title={t('symptoms.journal.form.manualDateTime')}
        onPress={() => setManual(currentManual => !currentManual)}
        testID={`${prefix}-manual`}
      />
      {manual ? (
        <View style={styles.row}>
          <TextInput
            accessibilityLabel={t(
              kind === 'onset'
                ? 'symptoms.journal.form.onset.date'
                : 'symptoms.journal.form.resolved.date',
            )}
            inputAccessoryViewID={accessoryIDs.date}
            onChangeText={next => {
              setSelectedInstant(null);
              onSelectInstant(null);
              setDate(next);
            }}
            placeholder="YYYY-MM-DD"
            style={[styles.input, styles.halfInput]}
            testID={`${prefix}-date`}
            value={date}
          />
          <TextInput
            accessibilityLabel={t(
              kind === 'onset'
                ? 'symptoms.journal.form.onset.time'
                : 'symptoms.journal.form.resolved.time',
            )}
            inputAccessoryViewID={accessoryIDs.time}
            onChangeText={next => {
              setSelectedInstant(null);
              onSelectInstant(null);
              setTime(next);
            }}
            placeholder="HH:MM"
            style={[styles.input, styles.halfInput]}
            testID={`${prefix}-time`}
            value={time}
          />
        </View>
      ) : null}
    </View>
  );
}
