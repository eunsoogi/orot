import { useState } from 'react';
import {
  Button,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { t } from '../i18n';
import type { SymptomFilter, SymptomStatus } from './types';
import SymptomFilterRange from './SymptomFilterRange';
import SymptomKeyboardAccessoryGroup from './SymptomKeyboardAccessoryGroup';
import {
  toLocalSymptomDateTime,
  toSymptomTimestamp,
  toSymptomThroughTimestamp,
} from './dateTime';
import { symptomStatusLabel } from './presentation';
import styles from './SymptomFilters.styles';
import {
  FILTER_KEYBOARD_FIELDS,
  filterInputAccessoryID,
} from './symptomFilterKeyboard';

// `all` is a UI-only choice; the domain filter keeps only persisted status values.
type StatusFilter = 'all' | SymptomStatus;
interface SymptomFiltersProps {
  disabled?: boolean;
  filter?: SymptomFilter;
  onFilterChange: (filter: SymptomFilter) => Promise<void> | void;
}

export default function SymptomFilters({
  disabled = false,
  filter = {},
  onFilterChange,
}: SymptomFiltersProps) {
  const from = filter.localFrom
    ? { date: filter.localFrom.slice(0, 10), time: filter.localFrom.slice(11) }
    : filter.fromOnsetAt
      ? toLocalSymptomDateTime(filter.fromOnsetAt)
      : null;
  const through = filter.localThrough
    ? {
        date: filter.localThrough.slice(0, 10),
        time: filter.localThrough.slice(11),
      }
    : filter.throughOnsetAt
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
  const [rangeExpanded, setRangeExpanded] = useState(Boolean(from || through));

  async function applyFilters(nextStatus = statusFilter) {
    setError('');
    const hasFrom = Boolean(fromDate.trim() || fromTime.trim());
    const hasThrough = Boolean(throughDate.trim() || throughTime.trim());
    const fromOnsetAt = hasFrom ? toSymptomTimestamp(fromDate, fromTime) : null;
    const throughOnsetAt = hasThrough
      ? toSymptomThroughTimestamp(throughDate, throughTime)
      : null;
    if ((hasFrom && !fromOnsetAt) || (hasThrough && !throughOnsetAt)) {
      setError(t('symptoms.journal.dateFilter.invalid'));
      return;
    }
    if (
      fromOnsetAt &&
      throughOnsetAt &&
      `${fromDate.trim()}T${fromTime.trim()}` >
        `${throughDate.trim()}T${throughTime.trim()}`
    ) {
      setError(t('symptoms.journal.dateFilter.order'));
      return;
    }
    try {
      await onFilterChange({
        ...(nextStatus === 'all' ? {} : { status: nextStatus }),
        ...(fromOnsetAt ? { fromOnsetAt } : {}),
        ...(throughOnsetAt ? { throughOnsetAt } : {}),
        ...(fromOnsetAt
          ? { localFrom: `${fromDate.trim()}T${fromTime.trim()}` }
          : {}),
        ...(throughOnsetAt
          ? { localThrough: `${throughDate.trim()}T${throughTime.trim()}` }
          : {}),
      });
    } catch {
      setError(t('symptoms.journal.filterError'));
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
      setError(t('symptoms.journal.filterError'));
    }
  }

  return (
    <>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="symptoms-filter-error"
        >
          {error}
        </Text>
      ) : null}
      <View style={styles.filterCard}>
        <Text style={styles.sectionTitle}>
          {t('symptoms.journal.statusFilter.title')}
        </Text>
        <View style={styles.row}>
          {(['all', 'active', 'resolved'] as StatusFilter[]).map(status => (
            <Pressable
              disabled={disabled}
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
              <Text style={styles.choiceLabel}>
                {status === 'all'
                  ? t('symptoms.journal.statusFilter.all')
                  : symptomStatusLabel(status)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionTitle}>
          {t('symptoms.journal.dateFilter.title')}
        </Text>
        <Pressable
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ expanded: rangeExpanded }}
          onPress={() => setRangeExpanded(value => !value)}
          style={styles.choice}
          testID="symptom-filter-period"
        >
          <Text style={styles.choiceLabel}>
            {fromDate || throughDate
              ? `${fromDate} ${fromTime} – ${throughDate} ${throughTime}`
              : t('symptoms.journal.dateFilter.all')}
          </Text>
        </Pressable>
        {rangeExpanded ? (
          <>
            <SymptomFilterRange
              disabled={disabled}
              values={[fromDate, fromTime, throughDate, throughTime]}
              onChange={[
                setFromDate,
                setFromTime,
                setThroughDate,
                setThroughTime,
              ]}
              accessoryID={index =>
                filterInputAccessoryID(
                  (
                    [
                      'fromDate',
                      'fromTime',
                      'throughDate',
                      'throughTime',
                    ] as const
                  )[index]!,
                )
              }
            />
            <Text style={styles.hint}>
              {t('symptoms.journal.dateFilter.guidance')}
            </Text>
            <Button
              disabled={disabled}
              onPress={() => {
                applyFilters();
              }}
              testID="symptom-filter-apply"
              title={t('symptoms.journal.dateFilter.apply')}
            />
            <Button
              disabled={disabled}
              onPress={() => {
                clearTimeRange();
              }}
              testID="symptom-filter-clear-time"
              title={t('symptoms.journal.dateFilter.clear')}
            />
          </>
        ) : null}
      </View>
      {Platform.OS === 'ios' ? (
        <SymptomKeyboardAccessoryGroup
          actions={[
            {
              label: t('symptoms.journal.dateFilter.apply'),
              testID: 'symptom-filter-keyboard-apply',
              disabled,
              onPress: () => {
                Keyboard.dismiss();
                applyFilters();
              },
            },
            {
              label: t('symptoms.journal.keyboard.done'),
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
