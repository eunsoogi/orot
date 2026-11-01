import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import { HealthRecordsCategoryFilter } from './HealthRecordsCategoryFilter';
import type { HealthRecordFilter } from './HealthRecordsCategoryFilter';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

export type HealthRecordsLibraryLoadState = 'loading' | 'ready' | 'failed';

interface HealthRecordsLibraryHeaderProps {
  readonly beforeFilters?: ReactNode;
  readonly hasSharedNavigation: boolean;
  readonly hasMore?: boolean;
  readonly loadState: HealthRecordsLibraryLoadState;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly retryInDock?: boolean;
  readonly onSelectCategory: (category: HealthRecordFilter) => void;
  readonly observationCount: number;
  readonly selectedCategory: HealthRecordFilter;
}

/** Keeps the record-library title, filters, and top-level load feedback together. */
export function HealthRecordsLibraryHeader({
  beforeFilters,
  hasSharedNavigation,
  hasMore = false,
  loadState,
  onBack,
  onRetry,
  retryInDock = true,
  onSelectCategory,
  observationCount,
  selectedCategory,
}: HealthRecordsLibraryHeaderProps) {
  const label = t('healthRecords.retry');
  const hasDock = useNavigationRouteActions(
    loadState === 'failed' && retryInDock
      ? [
          {
            id: 'retry-health-library',
            label,
            accessibilityLabel: label,
            testID: 'health-records-retry',
            systemImageName: 'arrow.clockwise',
            onPress: onRetry,
          },
        ]
      : [],
  );
  return (
    <View style={styles.header}>
      <View style={styles.topBar}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="health-records-title"
        >
          {t('healthRecords.title')}
        </Text>
        {hasSharedNavigation ? null : (
          <AppButton
            accessibilityLabel={navigationText.back.accessibilityLabel}
            onPress={onBack}
            testID="health-records-back"
            title={navigationText.back.label}
            variant="secondary"
          />
        )}
      </View>
      <Text style={styles.description}>{t('healthRecords.description')}</Text>
      {beforeFilters}
      <HealthRecordsCategoryFilter
        selected={selectedCategory}
        onSelect={onSelectCategory}
      />
      {hasMore ? <Text>{t('healthRecords.moreAvailable')}</Text> : null}
      {loadState === 'loading' ? (
        <Text testID="health-records-loading">
          {t('healthRecords.loading')}
        </Text>
      ) : null}
      {loadState === 'failed' ? (
        <View>
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="health-records-error"
          >
            {t('healthRecords.error')}
          </Text>
          {!hasDock || !retryInDock ? (
            <AppButton
              onPress={onRetry}
              testID="health-records-retry"
              title={t('healthRecords.retry')}
              variant="secondary"
            />
          ) : null}
        </View>
      ) : null}
      {loadState === 'ready' &&
      observationCount === 0 &&
      !hasMore &&
      selectedCategory === 'all' ? (
        <Text testID="health-records-empty">{t('healthRecords.empty')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 16 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { color: appColors.text, fontSize: 28, fontWeight: '700' },
  description: { color: appColors.secondary, lineHeight: 20 },
  error: { color: appColors.danger, marginBottom: 8 },
});
