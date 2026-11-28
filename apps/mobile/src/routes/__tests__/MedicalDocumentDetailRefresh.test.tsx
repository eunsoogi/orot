import { act, render, screen } from '@testing-library/react-native';
import type { AppStateStatus } from 'react-native';
import { AppState } from 'react-native';
import type {
  MedicalDocumentImportService,
  SavedMedicalDocument,
} from '../../medicalDocuments/medicalDocumentImportService';
import { NavigationRouteRefreshContext } from '../../navigation/navigationRouteRefresh';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { recentTestExecution } from '../testSupport/recentRecordsRouteTestSupport';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';
import { MedicalDocumentDetailRoute } from '../MedicalDocumentDetailRoute';

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
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

let publishProtection:
  ((event: ConversationExecutionEvent) => void) | undefined;
const originalAppState = AppState.currentState;
beforeEach(() => {
  publishProtection = undefined;
  jest.mocked(conversationExecutionNative).mockReturnValue({
    ...recentTestExecution,
    subscribe: listener => {
      publishProtection = listener;
      return () => {
        publishProtection = undefined;
      };
    },
  });
});
afterEach(() => {
  AppState.currentState = originalAppState;
});

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
        refresh = () => run(() => undefined);
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

test('ordinary app switching leaves painted document intact and retires the unsettled pull', async () => {
  let phaseChanged: ((value: AppStateStatus) => void) | undefined;
  const previous = jest
    .mocked(AppState.addEventListener)
    .getMockImplementation();
  const appState = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      phaseChanged = listener;
      return { remove: jest.fn() } as never;
    });
  try {
    const { getDocument, refresh } = await mount();
    const held = deferredDocument();
    getDocument.mockReturnValueOnce(held.promise);
    let request!: Promise<void>;
    await act(async () => {
      request = refresh();
    });
    expect(getDocument).toHaveBeenCalledTimes(2);
    await act(async () => {
      AppState.currentState = 'background';
      phaseChanged?.('background');
      AppState.currentState = 'active';
      phaseChanged?.('active');
      held.resolve(saved('Retired document result'));
      await request;
    });
    expect(screen.getByText('Original saved document')).toBeTruthy();
    expect(screen.queryByText('Retired document result')).toBeNull();
    expect(screen.queryByTestId('medical-document-detail-retry')).toBeNull();
    expect(getDocument).toHaveBeenCalledTimes(2);
    getDocument.mockResolvedValueOnce(
      saved('Explicit refresh after returning'),
    );
    await act(async () => {
      await refresh();
    });
    expect(screen.getByText('Explicit refresh after returning')).toBeTruthy();
  } finally {
    if (previous) appState.mockImplementation(previous);
    else appState.mockReturnValue({ remove: jest.fn() } as never);
  }
});

test('native protected-data loss removes already settled document text', async () => {
  const { getDocument } = await mount();
  await act(async () => {
    expect(publishProtection).toEqual(expect.any(Function));
    publishProtection?.({ kind: 'protectedData', available: false });
  });
  expect(screen.queryByText('Original saved document')).toBeNull();
  expect(screen.getByTestId('medical-document-detail-retry')).toBeTruthy();
  expect(getDocument).toHaveBeenCalledTimes(1);
});
