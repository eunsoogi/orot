import { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { t } from '../i18n';
import type { HealthRecordFilter } from './HealthRecordsCategoryFilter';
import { HealthRecordsLibraryHeader } from './HealthRecordsLibraryHeader';
import { HealthRecordsCategoryCard } from './HealthRecordsCategoryCard';
import { HealthRecordsMedicationCategoryCard } from './HealthRecordsMedicationCategoryCard';
import type { HealthRecordsMedicationLoader } from './healthRecordsMedicationLibrary';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import {
  healthRecordCategories,
  orderHealthRecordCategories,
} from './healthRecordsLibraryModel';
import {
  observationCategories,
  useHealthRecordCategoryPages,
} from './useHealthRecordCategoryPages';

interface HealthRecordsLibraryScreenProps {
  readonly loadObservations: HealthObservationPageLoader;
  readonly onBack: () => void;
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
  readonly loadMedicationData?: HealthRecordsMedicationLoader;
}

/** Summarizes imported values by type and keeps pagination bounded to storage pages. */
export function HealthRecordsLibraryScreen({
  loadObservations,
  onBack,
  onOpenDetail,
  loadMedicationData,
}: HealthRecordsLibraryScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [selectedCategory, setSelectedCategory] =
    useState<HealthRecordFilter>('blood_pressure');
  const { read, reload, revision } =
    useHealthRecordCategoryPages(loadObservations);
  const categories = healthRecordCategories();
  const states = observationCategories.map(read);
  const loadState = states.some(state => state.loadState === 'loading')
    ? 'loading'
    : states.some(state => state.loadState === 'failed')
      ? 'failed'
      : 'ready';
  const observationCount = states.reduce(
    (count, state) => count + state.records.length,
    0,
  );
  const hasMore = states.some(state => state.cursor !== null);
  const activeCategories =
    selectedCategory === 'all'
      ? observationCategories
      : selectedCategory === 'medications'
        ? []
        : [selectedCategory];
  const remaining = activeCategories.filter(
    category => read(category).cursor || read(category).loadState === 'failed',
  );
  const loadingMore = remaining.some(
    category => read(category).loadState === 'loading',
  );
  const failed = remaining.some(
    category => read(category).loadState === 'failed',
  );
  const loadNext = () => {
    for (const category of remaining) reload(category, read(category).cursor);
  };
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);
  // Promoting a category never restarts another card's pending query.
  const displayedCategories = orderHealthRecordCategories(
    categories,
    selectedCategory,
  );

  return (
    <FlatList
      data={displayedCategories}
      keyExtractor={category => category}
      contentContainerStyle={[styles.container, navigationInset]}
      ListFooterComponent={
        remaining.length > 0 ? (
          failed ? (
            <AppButton
              onPress={loadNext}
              testID="health-records-retry"
              title={t('healthRecords.retry')}
              variant="secondary"
            />
          ) : loadingMore ? (
            <Text testID="health-records-loading-more">
              {t('healthRecords.loading')}
            </Text>
          ) : (
            <AppButton
              onPress={loadNext}
              testID="health-records-load-older"
              title={t('healthRecords.loadOlder')}
              variant="secondary"
            />
          )
        ) : undefined
      }
      ListHeaderComponent={
        <HealthRecordsLibraryHeader
          hasSharedNavigation={hasSharedNavigation}
          loadState={loadState}
          observationCount={observationCount}
          hasMore={hasMore}
          onBack={onBack}
          onRetry={() => {
            for (const category of observationCategories) reload(category);
          }}
          onSelectCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
        />
      }
      onEndReached={() => {
        if (!loadingMore && !failed) loadNext();
      }}
      onEndReachedThreshold={0.5}
      renderItem={({ item: category }) =>
        category === 'medications' ? (
          <HealthRecordsMedicationCategoryCard
            loadMedicationData={loadMedicationData}
            onOpenDetail={onOpenDetail}
          />
        ) : (
          <HealthRecordsCategoryCard
            category={category}
            hasMore={read(category).cursor !== null}
            loadState={read(category).loadState}
            observations={read(category).records}
            onOpenDetail={onOpenDetail}
          />
        )
      }
      testID="health-records-scroll"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
});
