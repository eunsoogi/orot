import type { RecentMaterialRow } from '../../generatedReports/catalog';
import { RecordSourceNavigationProvider } from '../RecordSourceNavigation';
import { render } from '@testing-library/react-native';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { createNavigationController } from '../../navigation/navigationController';
import { RecordsSourcePaging } from '../RecordsSourcePagingContext';
import type { AppNavigationRoute } from '../appNavigationRoute';

export function recentRouteProps(): Omit<AppRouteContentProps, 'actions'> {
  return {
    activeTab: 'records',
    selectTab: jest.fn(),
    appointmentRepository: null,
    backupPreparationState: 'checking',
    retryBackupPreparation: async () => undefined,
    appointmentState: 'ready',
    nextAppointment: null,
    documentImportService: {
      listDocuments: async () => [],
      getDocument: async () => null,
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

export function renderRecords(
  controller: ReturnType<typeof createNavigationController<AppNavigationRoute>>,
  props: ReturnType<typeof recentRouteProps>,
  indexed = false,
) {
  return render(
    <RecordsSourcePaging.Provider value={indexed}>
      <RecordSourceNavigationProvider>
        <NavigationRouteAdapter
          controller={controller}
          contentLayoutOwner={appContentLayoutOwner}
          scrollable
          rootTabs={route =>
            route.name === 'root'
              ? { activeTab: 'records', onSelect: jest.fn() }
              : undefined
          }
        >
          {actions => <AppRouteContent {...props} actions={actions} />}
        </NavigationRouteAdapter>
      </RecordSourceNavigationProvider>
    </RecordsSourcePaging.Provider>,
  );
}

export function pendingVisitReports(): RecentMaterialRow[] {
  return Array.from({ length: 21 }, (_, index) => ({
    id: String(30 - index),
    key: 'visit:' + String(30 - index),
    origin: 'visit',
    kind: 'visit_questions',
    createdAt: '2026-11-22T09:34:00.000Z',
    unavailable: false,
  }));
}

export function holdRecentTestPage<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}
