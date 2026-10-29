import type { HealthObservationPageLoader } from '@orot/storage';
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef, useState } from 'react';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import { HealthRecordsDetailScreen } from '../healthkit/HealthRecordsDetailScreen';
import { HealthRecordsLibraryScreen } from '../healthkit/HealthRecordsLibraryScreen';
import { HealthRecordsMedicationDetailScreen } from '../healthkit/HealthRecordsMedicationDetailScreen';
import type { HealthRecordsDetailSelection } from '../healthkit/healthRecordsLibraryModel';
import type { HealthObservationCategory } from '../healthkit/healthRecordsLibraryModel';
import type { HealthRecordsMedicationLoader } from '../healthkit/healthRecordsMedicationLibrary';
import { t } from '../i18n';
import { RouteLoadError } from './RouteLoadError';
import type { AppNavigationRoute } from './appNavigationRoute';

interface HealthRecordsRouteProps {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly loadObservations: HealthObservationPageLoader;
  readonly loadMedicationData: HealthRecordsMedicationLoader;
  readonly onSelectionChange: (selection: HealthRecordsDetailSelection) => void;
  readonly route: 'health-records' | 'health-records-detail';
  readonly selection: HealthRecordsDetailSelection | null;
}

/** Owns the chart overview and its separately navigated, period-filtered detail list. */
export function HealthRecordsRoute({
  actions,
  loadMedicationData,
  loadObservations,
  onSelectionChange,
  route,
  selection,
}: HealthRecordsRouteProps) {
  const navigation = useContext(NavigationContext);
  const importPending = useRef(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  useEffect(
    () =>
      navigation?.addListener('focus', () => {
        // The retained library refreshes local storage after import return, including
        // cancellation. Neither selection nor the native scroll owner is remounted.
        if (importPending.current) {
          importPending.current = false;
          setRefreshRevision(value => value + 1);
        }
      }),
    [navigation],
  );
  if (route === 'health-records-detail') {
    if (!selection) {
      return (
        <RouteLoadError
          title={t('healthRecords.title')}
          message={t('healthRecords.detailOpenError')}
          onRetry={actions.onBack}
        />
      );
    }
    if (isObservationSelection(selection)) {
      return (
        <HealthRecordsDetailScreen
          key={selection.category + '-' + selection.period}
          loadObservations={loadObservations}
          onBack={actions.onBack}
          onSelectionChange={onSelectionChange}
          selection={selection}
        />
      );
    }
    return (
      <HealthRecordsMedicationDetailScreen
        key={selection.category + '-' + selection.period}
        loadMedicationData={loadMedicationData}
        onBack={actions.onBack}
        onSelectionChange={onSelectionChange}
        selection={selection}
      />
    );
  }
  // The library reuses the existing manual-import route and preserves its coordinator boundary.
  return (
    <HealthRecordsLibraryScreen
      loadMedicationData={loadMedicationData}
      loadObservations={loadObservations}
      onBack={actions.onBack}
      refreshRevision={refreshRevision}
      onOpenHealthImport={() => {
        importPending.current = actions.push('unified-import') !== null;
      }}
      onOpenDetail={detail => {
        onSelectionChange(detail);
        actions.push('health-records-detail');
      }}
    />
  );
}

type ObservationDetailSelection = Omit<
  HealthRecordsDetailSelection,
  'category'
> & { readonly category: HealthObservationCategory };

function isObservationSelection(
  selection: HealthRecordsDetailSelection,
): selection is ObservationDetailSelection {
  return selection.category !== 'medications';
}
