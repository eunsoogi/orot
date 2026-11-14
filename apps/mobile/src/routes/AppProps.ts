import type {
  AppointmentRepository,
  Appointment,
  HealthObservationPageLoader,
} from '@orot/storage';
import type {
  AiFeatureServices,
  AiFeatureServiceDependencies,
} from '../aiFeatures/integration/featureServices';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import type { AppRootTab } from '../navigation/rootTabs';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import type { HealthRecordsDetailSelection } from '../healthkit/healthRecordsLibraryModel';
import type { HealthRecordsMedicationLoader } from '../healthkit/healthRecordsMedicationLibrary';
import type { CalendarBridge } from '../calendar/types';
import type { CalendarAutoSyncActions } from '../calendar/useCalendarAutoSync';
import type { BackupPreparationDisplayState } from '../backup/useBackupPreparation';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../providers/selection';
import type { AppNavigationRoute } from './appNavigationRoute';
import type { MedicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';

/** Shared route input contract is separate from rendering so adding a destination does not grow the shell. */
export interface AppRouteContentProps {
  readonly documentImportService?: MedicalDocumentImportService;
  readonly loadSavedVisitQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly activeTab: AppRootTab;
  readonly onSelectRecordsSection?: (
    tab: 'records' | 'schedule',
  ) => Promise<void>;
  readonly selectTab: (tab: AppRootTab) => void;
  readonly appointmentRepository: AppointmentRepository | null;
  readonly backupPreparationState: BackupPreparationDisplayState;
  readonly retryBackupPreparation: () => Promise<void>;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly nextAppointment: Appointment | null;
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly refreshAppointments: () => Promise<void>;
  readonly refreshRecordings: () => Promise<void>;
  readonly calendarBridge: CalendarBridge;
  readonly calendarSync: CalendarAutoSyncActions;
  readonly selectedProvider: string;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
  readonly onProviderSelectionCommitted: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
  readonly openProviderSettings: () => void;
  readonly openVisitQuestions: () => void;
  readonly openDiseaseHypotheses: () => void;
  readonly openRagConversation: () => void;
  readonly openExternalEvidence: () => void;
  readonly openRecording: () => void;
  readonly loadHealthObservations: HealthObservationPageLoader;
  readonly loadHealthRecordMedications: HealthRecordsMedicationLoader;
  readonly healthRecordDetailSelection: HealthRecordsDetailSelection | null;
  readonly onHealthRecordDetailSelectionChange: (
    selection: HealthRecordsDetailSelection,
  ) => void;
}
