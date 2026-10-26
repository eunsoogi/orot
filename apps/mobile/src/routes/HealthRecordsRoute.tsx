import type { HealthObservationPageLoader } from '@orot/storage';
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
  return (
    <HealthRecordsLibraryScreen
      loadMedicationData={loadMedicationData}
      loadObservations={loadObservations}
      onBack={actions.onBack}
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
