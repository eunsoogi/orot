import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import {
  appContentLayoutOwner,
  appRouteIsScrollable,
} from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { RecordSourceNavigationProvider } from '../RecordSourceNavigation';
import { deleteMedicalDocument } from '../../medicalDocuments/medicalDocumentDeletion';
jest.mock('../../medicalDocuments/medicalDocumentDeletion', () => ({
  deleteMedicalDocument: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const document = {
  id: 'synthetic-document',
  sourceKind: 'medical_document' as const,
  title: 'Synthetic document',
  ingestedAt: '2026-11-15T00:00:00Z',
  provenance: { origin: 'imported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
  evidenceSpans: [],
};
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

async function renderRoute() {
  const controller = createNavigationController<AppNavigationRoute>('root');
  const props = routeProps();
  await render(
    <RecordSourceNavigationProvider>
      <NavigationRouteAdapter
        controller={controller}
        contentLayoutOwner={appContentLayoutOwner}
        scrollable={route => appRouteIsScrollable(route, 'records')}
        rootTabs={route =>
          route.name === 'root'
            ? { activeTab: 'records', onSelect: jest.fn() }
            : undefined
        }
      >
        {actions => <AppRouteContent {...props} actions={actions} />}
      </NavigationRouteAdapter>
    </RecordSourceNavigationProvider>,
  );
  return controller;
}

test.each([false, true])(
  'document detail is a native pop destination from full list=%s',
  async full => {
    const controller = await renderRoute();
    await screen.findByTestId('medical-document-source-0');
    if (full)
      await fireEvent.press(screen.getByTestId('records-recent-view-all'));
    const owner = controller.getSnapshot().currentRoute.key;
    await fireEvent.press(
      await screen.findByTestId('medical-document-source-0'),
    );
    await screen.findByTestId('medical-document-source-view');
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'medical-document-detail',
    );
    expect(controller.getSnapshot().canGoBack).toBe(true);
    expect(screen.queryByTestId('records-recent-sources')).toBeNull();
    expect(screen.queryByTestId('records-hub-header')).toBeNull();
    expect(screen.queryByTestId('records-section-tabs')).toBeNull();
    expect(screen.getAllByTestId('medical-document-delete')).toHaveLength(1);
    expect(
      within(screen.getByTestId('navigation-page-action-surface')).getByTestId(
        'medical-document-delete',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('medical-document-source-view')).queryByTestId(
        'medical-document-delete',
      ),
    ).toBeNull();
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(controller.getSnapshot().currentRoute.key).toBe(owner);
    await fireEvent.press(
      await screen.findByTestId('medical-document-source-0'),
    );
    await screen.findByTestId('medical-document-source-view');
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(controller.getSnapshot().currentRoute.key).toBe(owner);
  },
);

test('deletion invalidation clears excerpts while cleanup blocks Back, then returns to the owning list', async () => {
  let finish!: (value: { cleanupPending: boolean }) => void;
  jest.mocked(deleteMedicalDocument).mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const controller = await renderRoute();
  await fireEvent.press(await screen.findByTestId('medical-document-source-0'));
  await screen.findByTestId('medical-document-source-view');
  await fireEvent.press(screen.getByTestId('medical-document-delete'));
  const confirm = alert.mock.calls
    .at(-1)?.[2]
    ?.find(button => button.style === 'destructive');
  await act(async () => {
    confirm?.onPress?.();
  });
  await act(async () =>
    notifyLocalSourceDeleted('local', new Set([document.id])),
  );
  expect(screen.queryByTestId('medical-document-source-view')).toBeNull();
  expect(screen.getByTestId('navigation-back')).toBeDisabled();
  expect(controller.getSnapshot().currentRoute.name).toBe(
    'medical-document-detail',
  );
  await act(async () => {
    finish({ cleanupPending: false });
  });
  await waitFor(() =>
    expect(controller.getSnapshot().currentRoute.name).toBe('root'),
  );
  alert.mockRestore();
});
