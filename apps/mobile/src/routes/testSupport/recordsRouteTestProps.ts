import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import type { AppRouteContentProps } from '../AppProps';

export const document = {
  id: 'synthetic-document',
  sourceKind: 'medical_document' as const,
  title: 'Synthetic document',
  ingestedAt: '2026-11-15T00:00:00Z',
  provenance: { origin: 'imported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
  evidenceSpans: [],
};
export function recordsRouteTestProps(): Omit<AppRouteContentProps, 'actions'> {
  return {
    activeTab: 'records',
    appointmentRepository: null,
    backupPreparationState: 'checking',
    retryBackupPreparation: async () => undefined,
    appointmentState: 'ready',
    nextAppointment: null,
    documentImportService: {
      listDocuments: async () => [document],
      getDocument: async () => document,
      selectDocument: async () => null,
      saveDocument: async () => 'saved',
      discardDocument: async () => undefined,
    },
    recordings: Array.from({ length: 5 }, (_, index) => ({
      id: `synthetic-${index}`,
      sourceKind: 'audio_recording' as const,
      recordedAt: `2026-11-0${5 - index}T10:00:00Z`,
      ingestedAt: `2026-11-0${5 - index}T10:00:00Z`,
      effectiveAt: `2026-11-0${5 - index}T10:00:00Z`,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      title: `Synthetic recording ${index}`,
    })),
    recordingState: 'ready',
    refreshAppointments: async () => undefined,
    refreshRecordings: async () => undefined,
    calendarBridge: {
      requestAccessAndListUpcomingEvents: async () => ({
        access: 'notDetermined',
        events: [],
      }),
      findEvent: async () => ({ access: 'notDetermined', event: null }),
      addEventStoreListener: () => ({ remove: () => undefined }),
    },
    calendarSync: {
      ...emptyCalendarAutoSyncState,
      requestAccess: async () => null,
      refresh: async () => undefined,
    },
    selectedProvider: 'Synthetic provider',
    onProviderSelectionCommitted: jest.fn(),
    openProviderSettings: jest.fn(),
    openVisitQuestions: jest.fn(),
    openDiseaseHypotheses: jest.fn(),
    openRagConversation: jest.fn(),
    openExternalEvidence: jest.fn(),
    openRecording: jest.fn(),
    loadHealthObservations: async () => ({ records: [], nextCursor: null }),
    loadHealthRecordMedications: async () => ({
      definitions: [],
      doseEvents: [],
    }),
    healthRecordDetailSelection: null,
    onHealthRecordDetailSelectionChange: jest.fn(),
  };
}
