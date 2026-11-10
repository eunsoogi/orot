import type { ReactElement } from 'react';
import type {
  AppointmentRepository,
  HealthObservationPageLoader,
} from '@orot/storage';
import type { HealthObservation } from '@orot/domain';
import type { CalendarBridge } from '../calendar/types';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import type { VisitQuestionsRenderInput } from '../aiFeatures/integration/AiFeatureFlowScreen';
import type { AiFeatureServiceDependencies } from '../aiFeatures/integration/featureServices';
import type { HealthRecordsMedicationLoader } from '../healthkit/healthRecordsMedicationLibrary';
import type { MedicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';

/** Injection boundary for production defaults and deterministic app entry tests. */
export interface AppProps {
  loadAppointments?: () => Promise<AppointmentRepository>;
  loadRecordings?: () => Promise<readonly RecordingSourceRecord[]>;
  calendarBridge?: CalendarBridge;
  /** Keeps older blood-pressure fixtures working while the library uses one shared reader. */
  loadBloodPressureObservations?: () => Promise<readonly HealthObservation[]>;
  loadHealthObservations?: () => Promise<readonly HealthObservation[]>;
  loadHealthObservationPage?: HealthObservationPageLoader;
  loadHealthRecordMedications?: HealthRecordsMedicationLoader;
  aiFeatureServiceDependencies?: AiFeatureServiceDependencies;
  /** Keeps App navigation real while E2E supplies deterministic synthetic visit-question operations. */
  renderVisitQuestions?: (input: VisitQuestionsRenderInput) => ReactElement;
  /** Allows the dedicated picker probe to isolate storage while retaining app navigation. */
  documentImportService?: MedicalDocumentImportService;
}
