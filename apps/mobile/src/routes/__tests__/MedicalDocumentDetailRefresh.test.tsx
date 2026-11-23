import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type {
  MedicalDocumentImportService,
  SavedMedicalDocument,
} from '../../medicalDocuments/medicalDocumentImportService';
import { NavigationRouteRefreshContext } from '../../navigation/navigationRouteRefresh';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';
import { MedicalDocumentDetailRoute } from '../MedicalDocumentDetailRoute';

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => undefined,
  }),
}));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../medicalDocuments/MedicalDocumentSourceView', () => ({
  MedicalDocumentSourceView: ({
    document,
  }: {
    document: SavedMedicalDocument;
  }) => {
    const React = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return React.createElement(Text, {}, document.title);
  },
}));

function saved(title: string): SavedMedicalDocument {
  return {
    id: 'fixture-pdf',
    sourceKind: 'medical_document',
    title,
    ingestedAt: '2026-11-22T01:00:00Z',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    evidenceSpans: [],
  };
}

async function mount() {
  AppState.currentState = 'active';
  const getDocument = jest
    .fn<Promise<SavedMedicalDocument | null>, [string]>()
    .mockResolvedValue(saved('Original saved document'));
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn(),
    getDocument,
    selectDocument: jest.fn(),
    saveDocument: jest.fn(),
    discardDocument: jest.fn(),
  };
  let refresh: (() => Promise<void>) | undefined;
  await render(
    <NavigationRouteRefreshContext.Provider
      value={run => {
        refresh = run;
        return () => {
          refresh = undefined;
        };
      }}
    >
      <MedicalDocumentDetailRoute
        sourceId="fixture-pdf"
        service={service}
        onBack={jest.fn()}
      />
    </NavigationRouteRefreshContext.Provider>,
  );
  await screen.findByText('Original saved document');
  return { service, getDocument, refresh: () => refresh!() };
}

function deferredDocument() {
  let resolve!: (document: SavedMedicalDocument | null) => void;
  const promise = new Promise<SavedMedicalDocument | null>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('retains the exact saved detail and deduplicates a second pull', async () => {
  const { getDocument, service, refresh } = await mount();
  const held = deferredDocument();
  getDocument.mockReturnValueOnce(held.promise);
  let request!: Promise<void>;
  await act(async () => {
    request = refresh();
    await refresh();
  });
  expect(screen.getByText('Original saved document')).toBeTruthy();
  expect(getDocument.mock.calls).toEqual([['fixture-pdf'], ['fixture-pdf']]);
  await act(async () => {
    held.resolve(saved('Refreshed same saved document'));
    await request;
  });
  expect(screen.getByText('Refreshed same saved document')).toBeTruthy();
  expect(service.selectDocument).not.toHaveBeenCalled();
  expect(service.saveDocument).not.toHaveBeenCalled();
});

test('retired reads cannot republish deleted document data', async () => {
  const { getDocument, refresh } = await mount();
  const held = deferredDocument();
  getDocument.mockReturnValueOnce(held.promise);
  let request!: Promise<void>;
  await act(async () => {
    request = refresh();
    notifyLocalDataCleared();
  });
  await act(async () => {
    held.resolve(saved('Stale private title'));
    await request;
  });
  expect(screen.queryByText('Stale private title')).toBeNull();
  expect(screen.queryByText('Original saved document')).toBeNull();
});

test('a failed pull leaves a recoverable detail and a subsequent pull can recover that ID', async () => {
  const { getDocument, refresh } = await mount();
  getDocument.mockRejectedValueOnce(
    new Error('synthetic transient read failure'),
  );
  await act(async () => {
    await refresh();
  });
  expect(screen.getByTestId('medical-document-detail-retry')).toBeTruthy();
  getDocument.mockResolvedValueOnce(saved('Recovered original ID'));
  await act(async () => {
    await refresh();
  });
  expect(screen.getByText('Recovered original ID')).toBeTruthy();
  expect(getDocument.mock.calls).toEqual([
    ['fixture-pdf'],
    ['fixture-pdf'],
    ['fixture-pdf'],
  ]);
});
