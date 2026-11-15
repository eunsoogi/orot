import { RecordingSelectionProvider } from '../../recording/RecordingSelectionContext';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../appNavigationRoute';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function routeProps(): Omit<AppRouteContentProps, 'actions'> {
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

// Synthetic data exercises the production route switch and native-stack adapter, not a local expansion toggle.
test('opens all recent records in a separate route and Back restores the compact overview', async () => {
  const controller = createNavigationController<AppNavigationRoute>('root');
  const props = routeProps();
  await render(
    <RecordingSelectionProvider>
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
    </RecordingSelectionProvider>,
  );
  expect(screen.getByTestId('records-capture-actions')).toBeTruthy();
  expect(screen.queryByTestId('records-recent-source-synthetic-4')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-recent-view-all'));
  expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');
  expect(screen.getByTestId('records-recent-source-synthetic-4')).toBeTruthy();
  expect(screen.queryByTestId('records-capture-actions')).toBeNull();
  expect(screen.queryByTestId('records-hub-header')).toBeNull();
  expect(screen.queryByTestId('records-recent-view-all')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
  expect(screen.getByTestId('records-capture-actions')).toBeTruthy();
  expect(screen.queryByTestId('records-recent-source-synthetic-4')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-recent-view-all'));
  await fireEvent.press(
    screen.getByTestId('records-recent-source-synthetic-4'),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe('saved-recordings');
});
