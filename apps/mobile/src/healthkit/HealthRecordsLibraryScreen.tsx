import { ChartTooltipHost } from '../ui/charts/ChartTooltipHost';
import { useState } from 'react';
import {
  useNavigationEdgeMenu,
  useNavigationEdgeVerticalScroll,
} from '../navigation/navigationEdgeScroll';
import { FlatList, StyleSheet, View } from 'react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppButton } from '../layout/AppButton';
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
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

interface HealthRecordsLibraryScreenProps {
  readonly loadObservations: HealthObservationPageLoader;
  readonly onBack: () => void;
  readonly onOpenHealthImport: () => void;
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
  readonly loadMedicationData?: HealthRecordsMedicationLoader;
  readonly refreshRevision?: number;
}

/** Reads bounded category previews; scrolling never starts another storage page. */
export function HealthRecordsLibraryScreen({
  loadObservations,
  onBack,
  onOpenHealthImport,
  onOpenDetail,
  loadMedicationData,
  refreshRevision = 0,
}: HealthRecordsLibraryScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [panelWidth, setPanelWidth] = useState(0);
  // Measure the stable parent, never the extended list, so applying bleed
  // cannot change the width authority or oscillate between local/full edge.
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth: panelWidth,
    trailingPadding: navigationInset.paddingRight ?? libraryGutter,
  });
  const menuEdge = useNavigationEdgeMenu({
    ownerWidth: panelWidth,
    trailingGutter: navigationInset.paddingRight ?? libraryGutter,
  });
  const [selectedCategory, setSelectedCategory] =
    useState<HealthRecordFilter>('blood_pressure');
  const { read, reload, revision, monthWindow } = useHealthRecordCategoryPages(
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
  const retryInDock =
    states.some(
      state => state.loadState === 'failed' && state.retryCursor == null,
    ) ||
    (includesMedication && medication.status === 'failed');
  const retry = () => {
    for (const category of active)
      if (read(category).loadState === 'failed')
        reload(category, read(category).retryCursor ?? null);
    if (includesMedication && medication.status === 'failed')
      medication.reload();
  };
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  });
  const healthSettingsLabel = t('healthRecords.openHealthDataSettings');
  const hasDock = useNavigationRouteActions([
    {
      id: 'open-health-data-settings',
      label: healthSettingsLabel,
      accessibilityLabel: healthSettingsLabel,
      testID: 'health-records-open-health-import',
      systemImageName: 'arrow.down',
      onPress: onOpenHealthImport,
    },
  ]);
  const displayedCategories = filterHealthRecordCategories(
    healthRecordCategories(),
    selectedCategory,
  );
  return (
    <ChartTooltipHost style={styles.scroll}>
      <AdaptiveColumns
        routeKey="health-records-library"
        testID="health-records-layout"
        primary={
          <View
            style={styles.scroll}
            onLayout={event => setPanelWidth(event.nativeEvent.layout.width)}
            testID="health-records-primary-scroll-host"
          >
            <FlatList
              data={displayedCategories}
              keyExtractor={category => category}
              {...edge.indicatorProps}
              contentContainerStyle={[
                styles.container,
                navigationInset,
                edge.contentStyle,
              ]}
              ListHeaderComponent={
                <HealthRecordsLibraryHeader
                  beforeFilters={
                    !hasDock ? (
                      <AppButton
                        onPress={onOpenHealthImport}
                        testID="health-records-open-health-import"
                        title={t('healthRecords.openHealthDataSettings')}
                      />
                    ) : null
                  }
                  hasSharedNavigation={hasSharedNavigation}
                  loadState={loadState}
                  observationCount={observationCount}
                  hasMore={hasMore}
                  onBack={onBack}
                  onRetry={retry}
                  retryInDock={retryInDock}
                  onSelectCategory={setSelectedCategory}
                  selectedCategory={selectedCategory}
                  filterRailWidth={menuEdge.touchClearance}
                  filterRightBleed={menuEdge.rightBleed}
                />
              }
              ItemSeparatorComponent={CategoryDivider}
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
                    monthChart={
                      loadObservations.readMonthChart && {
                        load: loadObservations.readMonthChart,
                        window: monthWindow,
                      }
                    }
                    onOpenDetail={onOpenDetail}
                  />
                )
              }
              style={[styles.scroll, edge.scrollViewStyle]}
              testID="health-records-scroll"
            />
          </View>
        }
      />
    </ChartTooltipHost>
  );
}

const libraryGutter = 20;

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  container: {
    gap: 16,
    paddingHorizontal: libraryGutter,
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
