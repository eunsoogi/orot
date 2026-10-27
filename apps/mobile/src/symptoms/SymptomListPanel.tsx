import type { ReactNode } from 'react';
import { Button, Text, View } from 'react-native';
import SymptomFilters from './SymptomFilters';
import styles from './SymptomsScreen.styles';
import type { SymptomFilter } from './types';

/** Keeps the journal heading and filters with the list they control. */
export default function SymptomListPanel({
  backButtonVisible,
  children,
  disabled,
  error,
  filter,
  onBack,
  onFilterChange,
}: {
  readonly backButtonVisible: boolean;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly error: string;
  readonly filter: SymptomFilter;
  readonly onBack: () => void;
  readonly onFilterChange: (filter: SymptomFilter) => Promise<void> | void;
}) {
  return (
    <View style={styles.primaryPanel}>
      <View style={styles.topBar}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="symptoms-title"
        >
          Symptoms
        </Text>
        {backButtonVisible ? (
          <Button onPress={onBack} testID="symptoms-back" title="Back" />
        ) : null}
      </View>
      <Text style={styles.message}>
        Record what you notice in your own words.
      </Text>
      <Text style={styles.hint}>
        Journal entries are user-entered and not clinician-confirmed.
      </Text>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="symptoms-error"
        >
          {error}
        </Text>
      ) : null}
      {/* Filtering an edited row out must not silently discard its draft. */}
      <SymptomFilters
        disabled={disabled}
        filter={filter}
        onFilterChange={onFilterChange}
      />
      {children}
    </View>
  );
}
