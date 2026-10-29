import { useEffect, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { healthReviewText as copy } from '../i18n/healthReview';
import { healthReviewStyles as styles } from './styles';
import type { SafetyReadingDraft } from './safetyInput';

/** Render only a known instant in the current device timezone. */
export function formatMeasurementTime(
  value: string,
  timeZone?: string,
): string {
  if (!value || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(date);
}

export function MeasurementFields({
  row,
  index,
  disabled,
  onChange,
}: {
  row: SafetyReadingDraft;
  index: number;
  disabled: boolean;
  onChange: (value: SafetyReadingDraft) => void;
}) {
  const [draft, setDraft] = useState<Date | null>(null);
  const [, setAppearanceRevision] = useState(0);
  useEffect(() => {
    // A device timezone can change while the app is backgrounded; the instant stays untouched.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setAppearanceRevision(revision => revision + 1);
    });
    return () => subscription.remove();
  }, []);
  const set = (key: keyof SafetyReadingDraft, value: string) =>
    onChange({ ...row, [key]: value });
  return (
    <View style={styles.reading}>
      {(['systolic', 'diastolic'] as const).map(key => (
        <View key={key}>
          <Text>{copy[key]}</Text>
          <TextInput
            accessibilityLabel={`${copy[key]} ${index + 1}`}
            value={row[key]}
            editable={!disabled}
            keyboardType="numeric"
            style={styles.input}
            testID={`health-review-${key}-${index}`}
            onChangeText={value => set(key, value)}
          />
        </View>
      ))}
      <Text>{copy.measuredAt}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.measuredAt} ${index + 1}`}
        accessibilityValue={{
          text: formatMeasurementTime(row.measuredAt) || copy.chooseTime,
        }}
        disabled={disabled}
        style={styles.input}
        testID={`health-review-measuredAt-${index}`}
        onPress={() =>
          setDraft(
            formatMeasurementTime(row.measuredAt)
              ? new Date(row.measuredAt)
              : new Date(),
          )
        }
      >
        <Text>{formatMeasurementTime(row.measuredAt) || copy.chooseTime}</Text>
      </Pressable>
      <Text>{copy.source}</Text>
      <TextInput
        accessibilityLabel={`${copy.source} ${index + 1}`}
        value={row.source}
        editable={!disabled}
        style={styles.input}
        testID={`health-review-source-${index}`}
        onChangeText={value => set('source', value)}
      />
      <Modal
        testID="health-review-time-picker"
        visible={draft !== null}
        animationType="slide"
        onRequestClose={() => setDraft(null)}
      >
        <SafeAreaView style={styles.pickerScreen}>
          <ScrollView contentContainerStyle={styles.pickerPage}>
            <Text accessibilityRole="header">{copy.measuredAt}</Text>
            {draft ? (
              <>
                <DateTimePicker
                  value={draft}
                  mode="date"
                  display="inline"
                  onChange={(_, value) => value && setDraft(value)}
                />
                <DateTimePicker
                  value={draft}
                  mode="time"
                  display="spinner"
                  onChange={(_, value) => value && setDraft(value)}
                />
                <Text>{formatMeasurementTime(draft.toISOString())}</Text>
              </>
            ) : null}
            <AppButton
              title={copy.done}
              testID="health-review-time-done"
              onPress={() => {
                if (draft) set('measuredAt', draft.toISOString());
                setDraft(null);
              }}
            />
            <AppButton
              title={copy.cancelPicker}
              testID="health-review-time-cancel"
              variant="secondary"
              onPress={() => setDraft(null)}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
