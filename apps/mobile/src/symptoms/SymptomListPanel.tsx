import type { ReactNode } from 'react';
import { Button, Text, View } from 'react-native';
import { t } from '../i18n';
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
          {t('symptoms.title')}
        </Text>
        {backButtonVisible ? (
          <Button
            onPress={onBack}
            testID="symptoms-back"
            title={t('symptoms.journal.back')}
          />
        ) : null}
      </View>
      <Text style={styles.message}>{t('symptoms.description')}</Text>
      <Text style={styles.hint}>{t('symptoms.journal.provenance')}</Text>
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
