import { useCallback, useMemo, useState } from 'react';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import { HealthRecordsMedicationHistoryPanel } from './HealthRecordsMedicationHistoryPanel';
import { HealthRecordsMedicationSelectionPanel } from './HealthRecordsMedicationSelectionPanel';
import { buildHealthRecordsMedicationOptions } from './healthRecordsMedicationDetailModel';
import type { HealthRecordsMedicationLoader } from './healthRecordsMedicationLibrary';
import { useHealthRecordsMedicationDetailData } from './useHealthRecordsMedicationDetailData';

interface HealthRecordsMedicationDetailScreenProps {
  readonly loadMedicationData?: HealthRecordsMedicationLoader;
  readonly onBack: () => void;
  readonly onSelectionChange: (selection: HealthRecordsDetailSelection) => void;
  readonly selection: HealthRecordsDetailSelection;
}

/** Keeps medication summaries and their selected saved-event history as measured route panels. */
export function HealthRecordsMedicationDetailScreen({
  loadMedicationData,
  onBack,
  onSelectionChange,
  selection,
}: HealthRecordsMedicationDetailScreenProps) {
  const navigationInset = useNavigationContentInset();
  const { cursor, data, loadState, reload, revision, rows } =
    useHealthRecordsMedicationDetailData(selection.period, loadMedicationData);
  const [selectedMedicationId, setSelectedMedicationId] = useState<
    string | null
  >(null);
  const options = useMemo(
    () => buildHealthRecordsMedicationOptions(data, rows),
    [data, rows],
  );
  const selectedMedication =
    options.find(option => option.id === selectedMedicationId) ??
    options[0] ??
    null;
  const selectedRows = useMemo(
    () =>
      selectedMedication
        ? rows.filter(
            row =>
              row.doseEvent.medicationDefinitionId === selectedMedication.id,
          )
        : [],
    [rows, selectedMedication],
  );
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);
  const onRetry = useCallback(() => reload(cursor), [cursor, reload]);
  const onLoadMore = useCallback(() => {
    if (cursor && loadState === 'ready') {
      reload(cursor).catch(() => undefined);
    }
  }, [cursor, loadState, reload]);

  // The route owns selection so geometry changes reflow mounted panels without losing it.
  return (
    <AdaptiveColumns
      primary={
        <HealthRecordsMedicationSelectionPanel
          cursor={cursor}
          hasSharedNavigation={hasSharedNavigation}
          loadState={loadState}
          navigationInset={navigationInset}
          onBack={onBack}
          onRetry={onRetry}
          onSelectMedication={setSelectedMedicationId}
          onSelectionChange={onSelectionChange}
          options={options}
          rowCount={rows.length}
          selectedMedicationId={selectedMedication?.id ?? null}
          selection={selection}
        />
      }
      routeKey="health-records-medication-detail"
      secondary={
        <HealthRecordsMedicationHistoryPanel
          cursor={cursor}
          loadState={loadState}
          navigationInset={navigationInset}
          onLoadMore={onLoadMore}
          rows={selectedRows}
          selectedMedication={selectedMedication}
        />
      }
      testID="health-records-medication-detail-layout"
    />
  );
}
