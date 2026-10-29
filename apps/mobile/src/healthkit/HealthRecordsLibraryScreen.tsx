import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { t } from '../i18n';
import type { HealthRecordFilter } from './HealthRecordsCategoryFilter';
import { HealthRecordsLibraryHeader } from './HealthRecordsLibraryHeader';
import { HealthRecordsCategoryCard } from './HealthRecordsCategoryCard';
import { HealthRecordsMedicationCategoryCard } from './HealthRecordsMedicationCategoryCard';
import type { HealthRecordsMedicationLoader } from './healthRecordsMedicationLibrary';
import { useHealthRecordsMedicationSummary } from './useHealthRecordsMedicationSummary';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import {
  healthRecordCategories,
  filterHealthRecordCategories,
} from './healthRecordsLibraryModel';
import {
  observationCategories,
  useHealthRecordCategoryPages,
} from './useHealthRecordCategoryPages';

interface HealthRecordsLibraryScreenProps {
  readonly loadObservations: HealthObservationPageLoader;
  readonly onBack: () => void;
  readonly onOpenHealthImport: () => void;
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
  readonly loadMedicationData?: HealthRecordsMedicationLoader;
  readonly refreshRevision?: number;
}

/** One virtualized page owns the introduction, import, horizontal filters and category results. */
export function HealthRecordsLibraryScreen({
  loadObservations,
  onBack,
  onOpenHealthImport,
  onOpenDetail,
  loadMedicationData,
  refreshRevision = 0,
}: HealthRecordsLibraryScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [selectedCategory, setSelectedCategory] =
    useState<HealthRecordFilter>('blood_pressure');
  const { read, reload, revision } = useHealthRecordCategoryPages(
    loadObservations,
    refreshRevision,
  );
  // Summary state belongs to the route, not the virtualized medication card.
  const medication = useHealthRecordsMedicationSummary(
    loadMedicationData,
    refreshRevision,
  );
  const active =
    selectedCategory === 'all'
      ? observationCategories
      : selectedCategory === 'medications'
        ? []
        : [selectedCategory];
  const states = active.map(read);
  const includesMedication =
    selectedCategory === 'all' || selectedCategory === 'medications';
  const statuses = [
    ...states.map(state => state.loadState),
    ...(includesMedication ? [medication.status] : []),
  ];
  const loadState = statuses.includes('failed')
    ? 'failed'
    : statuses.includes('loading')
      ? 'loading'
      : 'ready';
  const observationCount =
    states.reduce((count, state) => count + state.records.length, 0) +
    (includesMedication
      ? (medication.data.totalDefinitions ??
          medication.data.definitions.length) +
        (medication.data.totalDoseEvents ?? medication.data.doseEvents.length)
      : 0);
  const hasMore = states.some(state => state.cursor !== null);
  const remaining = active.filter(category => read(category).cursor !== null);
  const loadingMore = states.some(state => state.loadState === 'loading');
  const failed = states.some(state => state.loadState === 'failed');
  const retry = () => {
    for (const category of active)
      if (read(category).loadState === 'failed')
        reload(category, read(category).retryCursor ?? null);
    if (includesMedication && medication.status === 'failed')
      medication.reload();
  };
  const loadNext = () => {
    for (const category of remaining)
      if (read(category).loadState === 'ready')
        reload(category, read(category).cursor);
  };
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  });
  const displayedCategories = filterHealthRecordCategories(
    healthRecordCategories(),
    selectedCategory,
  );
  return (
    <AdaptiveColumns
      routeKey="health-records-library"
      testID="health-records-layout"
      primary={
        <FlatList
          data={displayedCategories}
          keyExtractor={category => category}
          contentContainerStyle={[styles.container, navigationInset]}
          ListHeaderComponent={
            <HealthRecordsLibraryHeader
              beforeFilters={
                <AppButton
                  onPress={onOpenHealthImport}
                  testID="health-records-open-health-import"
                  title={t('healthRecords.importHealthData')}
                />
              }
              hasSharedNavigation={hasSharedNavigation}
              loadState={loadState}
              observationCount={observationCount}
              hasMore={hasMore}
              onBack={onBack}
              onRetry={retry}
              onSelectCategory={setSelectedCategory}
              selectedCategory={selectedCategory}
            />
          }
          ItemSeparatorComponent={CategoryDivider}
          ListFooterComponent={
            remaining.length > 0 && !failed ? (
              loadingMore ? (
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
          onEndReached={() => {
            if (!loadingMore && !failed) loadNext();
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item: category }) =>
            category === 'medications' ? (
              <HealthRecordsMedicationCategoryCard
                summary={medication}
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
          style={styles.scroll}
          testID="health-records-scroll"
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  container: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  divider: {
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

/** A static separator keeps virtualized row identity stable during refresh. */
function CategoryDivider() {
  return <View style={styles.divider} />;
}
