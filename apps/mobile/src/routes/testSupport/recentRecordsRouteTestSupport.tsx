import type { ComponentType, PropsWithChildren } from 'react';
import type { ConversationExecutionAdapter } from '../../ragConversation/conversationExecutionLease';
import type { RecordRepository } from '@orot/storage';
import type { RecordingSourceRecord } from '../../recording/recordingTypes';
import type { RecentMaterialRow } from '../../generatedReports/catalog';
import { RecordSourceNavigationProvider } from '../RecordSourceNavigation';
import { render } from '@testing-library/react-native';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import { AppRouteContent } from '../AppRouteContent';
import { RecordsHubSection } from '../RecordsHubSection';
import type { AppRouteContentProps } from '../AppProps';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { createNavigationController } from '../../navigation/navigationController';
import { AppOverviewDataBoundary } from '../AppOverviewDataBoundary';
import { loadRecordingSummaries } from '../../recording/loadRecordingSummaries';
import { RecordsSourcePaging } from '../RecordsSourcePagingContext';
import type { AppNavigationRoute } from '../appNavigationRoute';

export function recentRouteProps(): Omit<AppRouteContentProps, 'actions'> {
  return {
    activeTab: 'records',
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
  indexed: boolean | 'app-default' = false,
  wrapper?: ComponentType<PropsWithChildren>,
) {
  const routes = (
    <RecordSourceNavigationProvider>
      <NavigationRouteAdapter
        controller={controller}
        contentLayoutOwner={appContentLayoutOwner}
        scrollable={route => route.name !== 'root'}
        rootTabs={route =>
          route.name === 'root'
            ? { activeTab: 'records', onSelect: jest.fn() }
            : undefined
        }
      >
        {actions =>
          actions.route.name === 'root' ? (
            <RecordsHubSection>
              <AppRouteContent {...props} actions={actions} />
            </RecordsHubSection>
          ) : (
            <AppRouteContent {...props} actions={actions} />
          )
        }
      </NavigationRouteAdapter>
    </RecordSourceNavigationProvider>
  );
  return render(
    indexed === 'app-default' ? (
      <AppOverviewDataBoundary
        activeTab="records"
        controller={controller}
        loadAppointments={async () => {
          throw new Error('Inactive fixture appointments');
        }}
        loadRecordings={loadRecordingSummaries}
      >
        {routes}
      </AppOverviewDataBoundary>
    ) : (
      <RecordsSourcePaging.Provider value={indexed}>
        {routes}
      </RecordsSourcePaging.Provider>
    ),
    { wrapper },
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

/** Persist actual mixed source metadata; this test never opens file or audio content. */
export async function seedIndexedRecentSources(
  records: RecordRepository,
  fixture: RecordingSourceRecord,
  timestamp: string,
) {
  const source = {
    ...fixture,
    id: 'audio-43',
    recordedAt: timestamp,
    ingestedAt: '2026-11-22T09:33:00.000Z',
    recordingDurationMs: 120,
  };
  for (let i = 0; i < 44; i++) {
    await records.put('source_record', {
      ...source,
      id: 'audio-' + String(i).padStart(2, '0'),
    });
  }
  for (const [id, title, ingestedAt] of [
    ['imported-photo', 'Synthetic imported photo', '2026-11-22T09:31:00.000Z'],
    ['imported-file', 'Synthetic imported file', '2026-11-22T09:29:00.000Z'],
  ]) {
    await records.put('source_record', {
      sourceKind: 'medical_document',
      id,
      title,
      ingestedAt,
      provenance: { origin: 'imported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
  }
  return source;
}

/** Model the positive protected-data witness without exercising the iOS bridge. */
export const recentTestExecution: ConversationExecutionAdapter = {
  bridgeAvailable: true,
  protectedDataAvailable: async () => true,
  subscribe: () => () => {},
  currentPhase: () => 'active',
  begin: jest.fn(),
  end: jest.fn(),
  isActive: jest.fn(),
};
