import { useState } from 'react';
import {
  Button,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { SymptomFilter, SymptomStatus } from './types';
import SymptomKeyboardAccessoryGroup from './SymptomKeyboardAccessoryGroup';
import { toLocalSymptomDateTime, toSymptomTimestamp } from './dateTime';
import styles from './SymptomFilters.styles';

type StatusFilter = 'all' | SymptomStatus;
const FILTER_INPUT_ACCESSORY_IDS = {
  fromDate: 'symptom-filter-accessory-from-date',
  fromTime: 'symptom-filter-accessory-from-time',
  throughDate: 'symptom-filter-accessory-through-date',
  throughTime: 'symptom-filter-accessory-through-time',
};
const FILTER_KEYBOARD_FIELDS = [
  { nativeID: FILTER_INPUT_ACCESSORY_IDS.fromDate, testSuffix: 'from-date' },
  { nativeID: FILTER_INPUT_ACCESSORY_IDS.fromTime, testSuffix: 'from-time' },
  {
    nativeID: FILTER_INPUT_ACCESSORY_IDS.throughDate,
    testSuffix: 'through-date',
  },
  {
    nativeID: FILTER_INPUT_ACCESSORY_IDS.throughTime,
    testSuffix: 'through-time',
  },
];

type FilterInputKey = keyof typeof FILTER_INPUT_ACCESSORY_IDS;

function filterInputAccessoryID(field: FilterInputKey): string | undefined {
  return Platform.OS === 'ios' ? FILTER_INPUT_ACCESSORY_IDS[field] : undefined;
}

interface SymptomFiltersProps {
  filter?: SymptomFilter;
  onFilterChange: (filter: SymptomFilter) => Promise<void> | void;
}

export default function SymptomFilters({
  filter = {},
  onFilterChange,
}: SymptomFiltersProps) {
  const from = filter.fromOnsetAt
    ? toLocalSymptomDateTime(filter.fromOnsetAt)
    : null;
  const through = filter.throughOnsetAt
    ? toLocalSymptomDateTime(filter.throughOnsetAt)
    : null;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    filter.status ?? 'all',
  );
  const [fromDate, setFromDate] = useState(from?.date ?? '');
  const [fromTime, setFromTime] = useState(from?.time ?? '');
  const [throughDate, setThroughDate] = useState(through?.date ?? '');
  const [throughTime, setThroughTime] = useState(through?.time ?? '');
  const [error, setError] = useState('');

  async function applyFilters(nextStatus = statusFilter) {
    setError('');
    const hasFrom = Boolean(fromDate.trim() || fromTime.trim());
    const hasThrough = Boolean(throughDate.trim() || throughTime.trim());
    const fromOnsetAt = hasFrom ? toSymptomTimestamp(fromDate, fromTime) : null;
    const throughOnsetAt = hasThrough
      ? toSymptomTimestamp(throughDate, throughTime)
      : null;
    if ((hasFrom && !fromOnsetAt) || (hasThrough && !throughOnsetAt)) {
      setError('Enter a valid date and time for each range boundary.');
      return;
    }
    if (
      fromOnsetAt &&
      throughOnsetAt &&
      new Date(fromOnsetAt).getTime() > new Date(throughOnsetAt).getTime()
    ) {
      setError('The end of the time range must follow its start.');
      return;
    }
    try {
      await onFilterChange({
        ...(nextStatus === 'all' ? {} : { status: nextStatus }),
        ...(fromOnsetAt ? { fromOnsetAt } : {}),
        ...(throughOnsetAt ? { throughOnsetAt } : {}),
      });
    } catch {
      setError('Symptoms could not be filtered. Try again.');
    }
  }

  async function clearTimeRange() {
    setFromDate('');
    setFromTime('');
    setThroughDate('');
    setThroughTime('');
    setError('');
    try {
      await onFilterChange(
        statusFilter === 'all' ? {} : { status: statusFilter },
      );
    } catch {
      setError('Symptoms could not be filtered. Try again.');
    }
  }

  return (
    <>
      {error ? (
        <Text accessibilityRole="alert" testID="symptoms-filter-error">
          {error}
        </Text>
      ) : null}
      <View style={styles.filterCard}>
        <Text style={styles.sectionTitle}>Filter by status</Text>
        <View style={styles.row}>
          {(['all', 'active', 'resolved'] as StatusFilter[]).map(status => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: statusFilter === status }}
              key={status}
              onPress={() => {
                setStatusFilter(status);
                applyFilters(status);
              }}
              style={[
                styles.choice,
                statusFilter === status ? styles.selectedChoice : null,
              ]}
              testID={`symptom-filter-${status}`}
            >
              <Text>
                {status === 'all'
                  ? 'All'
                  : status === 'active'
                  ? 'Active'
                  : 'Resolved'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionTitle}>Filter by onset time</Text>
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="From onset date"
            inputAccessoryViewID={filterInputAccessoryID('fromDate')}
            onChangeText={setFromDate}
            placeholder="From date"
            style={[styles.input, styles.halfInput]}
            testID="symptom-filter-from-date"
            value={fromDate}
          />
          <TextInput
            accessibilityLabel="From onset time"
            inputAccessoryViewID={filterInputAccessoryID('fromTime')}
            onChangeText={setFromTime}
            placeholder="HH:MM"
            style={[styles.input, styles.halfInput]}
            testID="symptom-filter-from-time"
            value={fromTime}
          />
        </View>
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Through onset date"
            inputAccessoryViewID={filterInputAccessoryID('throughDate')}
            onChangeText={setThroughDate}
            placeholder="Through date"
            style={[styles.input, styles.halfInput]}
            testID="symptom-filter-through-date"
            value={throughDate}
          />
          <TextInput
            accessibilityLabel="Through onset time"
            inputAccessoryViewID={filterInputAccessoryID('throughTime')}
            onChangeText={setThroughTime}
            placeholder="HH:MM"
            style={[styles.input, styles.halfInput]}
            testID="symptom-filter-through-time"
            value={throughTime}
          />
        </View>
        <Text style={styles.hint}>
          Range endpoints include the entered local times.
        </Text>
        <Button
          onPress={() => {
            applyFilters();
          }}
          testID="symptom-filter-apply"
          title="Apply time range"
        />
        <Button
          onPress={() => {
            clearTimeRange();
          }}
          testID="symptom-filter-clear-time"
          title="Clear time range"
        />
      </View>
      {Platform.OS === 'ios' ? (
        <SymptomKeyboardAccessoryGroup
          actions={[
            {
              label: 'Apply time range',
              testID: 'symptom-filter-keyboard-apply',
              onPress: () => {
                Keyboard.dismiss();
                applyFilters();
              },
            },
            {
              label: 'Done',
              testID: 'symptom-filter-keyboard-done',
              onPress: Keyboard.dismiss,
            },
          ]}
          fields={FILTER_KEYBOARD_FIELDS}
        />
      ) : null}
    </>
  );
}
