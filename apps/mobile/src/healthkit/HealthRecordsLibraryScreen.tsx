import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import type {
  HealthObservationCursor,
  HealthObservationPage,
} from '@orot/storage';
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
import type { HealthRecordsMedicationData } from './healthRecordsMedicationLibrary';
import type {
  HealthObservationCategory,
  HealthRecordsDetailSelection,
} from './healthRecordsLibraryModel';
import {
  classifyHealthObservation,
  healthRecordCategories,
  orderHealthRecordCategories,
} from './healthRecordsLibraryModel';

interface HealthRecordsLibraryScreenProps {
  readonly loadObservations: (
    cursor: HealthObservationCursor | null,
  ) => Promise<HealthObservationPage>;
  readonly onBack: () => void;
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
  readonly loadMedicationData?: () => Promise<HealthRecordsMedicationData>;
}

/** Summarizes imported values by type and keeps pagination bounded to storage pages. */
export function HealthRecordsLibraryScreen({
  loadObservations,
  onBack,
  onOpenDetail,
  loadMedicationData,
}: HealthRecordsLibraryScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [observations, setObservations] = useState<
    readonly HealthObservation[]
  >([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState<HealthObservationCursor | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<HealthRecordFilter>('all');
  const generation = useRef(0);
  const pending = useRef(false);
  const initialFilterChosen = useRef(false);
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);
  const categories = healthRecordCategories();
  const recordsByCategory = useMemo(() => {
    const grouped = new Map<HealthObservationCategory, HealthObservation[]>();
    for (const observation of observations) {
      const category = classifyHealthObservation(observation);
      const records = grouped.get(category) ?? [];
      records.push(observation);
      grouped.set(category, records);
    }
    return grouped;
  }, [observations]);
  // The filter promotes a record type without hiding the remaining type cards.
  const displayedCategories = orderHealthRecordCategories(
    categories,
    selectedCategory,
  );

  const reload = useCallback(
    async (after: HealthObservationCursor | null = null) => {
      if (pending.current) return;
      pending.current = true;
      const request = ++generation.current;
      setLoadState('loading');
      try {
        const page = await loadObservations(after);
        if (request !== generation.current) return;
        setObservations(current =>
          after ? [...current, ...page.records] : page.records,
        );
        setCursor(page.nextCursor);
        setLoadState('ready');
      } catch {
        if (request === generation.current) setLoadState('failed');
      } finally {
        if (request === generation.current) {
          pending.current = false;
          setRevision(current => current + 1);
        }
      }
    },
    [loadObservations],
  );

  useEffect(() => {
    pending.current = false;
    setObservations([]);
    setCursor(null);
    void reload();
    return () => {
      // A late read from an unmounted route must not replace the next route's records.
      generation.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    if (loadState !== 'ready' || initialFilterChosen.current) return;
    initialFilterChosen.current = true;
    if (categories.includes('blood_pressure')) {
      setSelectedCategory('blood_pressure');
    }
  }, [categories, loadState]);

  return (
    <FlatList
      data={displayedCategories}
      keyExtractor={category => category}
      contentContainerStyle={[styles.container, navigationInset]}
      ListFooterComponent={
        cursor ? (
          loadState === 'failed' ? (
            <AppButton
              onPress={() => void reload(cursor)}
              testID="health-records-retry"
              title={t('healthRecords.retry')}
              variant="secondary"
            />
          ) : loadState === 'loading' ? (
            <Text testID="health-records-loading-more">
              {t('healthRecords.loading')}
            </Text>
          ) : undefined
        ) : undefined
      }
      ListHeaderComponent={
        <HealthRecordsLibraryHeader
          hasSharedNavigation={hasSharedNavigation}
          loadState={loadState}
          observationCount={observations.length}
          onBack={onBack}
          onRetry={() => void reload(null)}
          onSelectCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
        />
      }
      onEndReached={() => {
        if (cursor && loadState === 'ready') void reload(cursor);
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
            loadState={loadState}
            observations={recordsByCategory.get(category) ?? []}
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
