import { render, screen } from '@testing-library/react-native';
import type { SymptomEntry } from '@orot/storage';
import type { SymptomJournalRepository } from '../../symptoms/localRepository';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import type { AppNavigationRoute } from '../appNavigationRoute';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../medicalDocuments/medicalDocumentImportService', () => ({
  medicalDocumentImportService: {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  },
}));

function symptomEntry(): SymptomEntry {
  const timestamp = new Date().toISOString();
  return {
    id: 'symptom-from-app-source',
    effectiveAt: timestamp,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: 'App injected journal entry',
    status: 'active',
  };
}

function appProps(
  loadSymptoms: NonNullable<AppRouteContentProps['loadSymptoms']>,
): AppRouteContentProps {
  const actions: NavigationRouteActions<AppNavigationRoute> = {
    route: { key: 'root', name: 'home' },
    onBack: async () => true,
    onHome: async () => true,
    push: () => null,
    replace: () => null,
    registerLeaveState: () => () => {},
  };

  return {
    actions,
    activeTab: 'records',
    selectTab: jest.fn(),
    appointmentRepository: null,
    backupPreparationState: 'checking',
    retryBackupPreparation: async () => undefined,
    appointmentState: 'ready',
    nextAppointment: null,
    recordings: [],
    recordingState: 'ready',
    refreshAppointments: async () => undefined,
    refreshRecordings: async () => undefined,
    calendarBridge: {} as AppRouteContentProps['calendarBridge'],
    calendarSync: {} as AppRouteContentProps['calendarSync'],
    selectedProvider: 'apple',
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
    loadSymptoms,
  };
}

test('uses the app-injected symptom journal for the Records recent feed', async () => {
  const entry = symptomEntry();
  const repository: SymptomJournalRepository = {
    list: jest.fn(async () => [entry]),
    create: async () => entry,
    update: async () => null,
    resolve: async () => null,
  };
  const loadSymptoms = jest.fn(async () => repository);

  await render(<AppRouteContent {...appProps(loadSymptoms)} />);

  expect(
    await screen.findByTestId('records-recent-symptom-symptom-from-app-source'),
  ).toBeTruthy();
  expect(screen.getByText('App injected journal entry')).toBeTruthy();
  expect(loadSymptoms).toHaveBeenCalledTimes(1);
  expect(repository.list).toHaveBeenCalledTimes(1);
});
