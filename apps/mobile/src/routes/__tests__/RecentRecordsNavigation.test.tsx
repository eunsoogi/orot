import { AppState } from 'react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { loadRecentMaterial } from '../../generatedReports/recentMaterialReader';
import { openGeneratedReportReader } from '../../generatedReports/readers';
import { act, fireEvent, screen } from '@testing-library/react-native';
import {
  renderRecords,
  recentTestExecution,
  recentRouteProps as routeProps,
} from '../testSupport/recentRecordsRouteTestSupport';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../appNavigationRoute';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(),
}));
jest.mock('../../generatedReports/readers', () => ({
  openGeneratedReportReader: jest.fn(),
}));
// The selected detail uses a synthetic local history renderer; exact read authority is tested separately.
jest.mock('../../memory/HistoryMemoryDetail', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  const { useNavigationLeaveStateRegistration } =
    jest.requireActual('../../navigation');
  return {
    HistoryMemoryDetail: ({ record }: { record: { details: string } }) => {
      useNavigationLeaveStateRegistration({
        canLeave: true,
        hasUnsavedChanges: false,
        isRecording: false,
        hasOngoingOperation: false,
        revision: 0,
        inputRevision: 0,
      });
      return React.createElement(Text, null, record.details);
    },
  };
});
jest.mock('../../memory/SavedMemoryLoaderContext', () => {
  const { createContext } = jest.requireActual('react');
  const record = {
    id: 'conversation-local-memory:synthetic',
    kind: 'note',
    title: 'Synthetic saved memory',
    details: 'synthetic memory body',
    effectiveDate: { status: 'unknown' },
    recordedAt: '2026-11-05T10:03:00Z',
    provenance: { origin: 'user_reported' },
    reviewState: { status: 'unreviewed' },
  };
  return {
    SavedMemoryLoaderContext: createContext(async () => [
      {
        sourceKind: 'manual_history',
        id: 'manual-history:' + record.id,
        text: record.details,
        createdAt: Date.parse(record.recordedAt),
        record,
      },
    ]),
  };
});

function allowSavedMaterial() {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
}

// Synthetic data exercises the production route switch and native-stack adapter, not a local expansion toggle.
test('opens all recent records in a separate route and Back restores the compact overview', async () => {
  allowSavedMaterial();
  jest.mocked(loadRecentMaterial).mockResolvedValue([]);
  const controller = createNavigationController<AppNavigationRoute>('root');
  const props = routeProps();
  await renderRecords(controller, props);
  expect(screen.getByTestId('records-capture-actions')).toBeTruthy();
  expect(screen.queryByTestId('records-recent-source-synthetic-4')).toBeNull();
  await fireEvent.press(await screen.findByTestId('records-recent-view-all'));
  expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');
  expect(screen.getByTestId('records-recent-source-synthetic-4')).toBeTruthy();
  expect(screen.queryByTestId('records-capture-actions')).toBeNull();
  expect(screen.queryByTestId('records-hub-header')).toBeNull();
  expect(screen.queryByTestId('records-recent-view-all')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
  expect(screen.getByTestId('records-capture-actions')).toBeTruthy();
  expect(screen.queryByTestId('records-recent-source-synthetic-4')).toBeNull();
  await fireEvent.press(await screen.findByTestId('records-recent-view-all'));
  await fireEvent.press(
    screen.getByTestId('records-recent-source-synthetic-4'),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe('recording-review');
  expect(screen.getByTestId('recording-review-layout')).toBeTruthy();
});

test('lists five categories together and opens each selected protected destination without preview prose', async () => {
  allowSavedMaterial();
  const report = {
    key: 'visit:synthetic',
    id: 'synthetic',
    origin: 'visit' as const,
    kind: 'visit_questions' as const,
    createdAt: '2026-11-05T10:01:00Z',
    unavailable: false,
  };
  jest.mocked(loadRecentMaterial).mockResolvedValue([
    {
      key: 'memory:synthetic',
      id: 'manual-history:conversation-local-memory:synthetic',
      origin: 'memory',
      createdAt: '2026-11-05T10:03:00Z',
    },
    report,
  ]);
  const read = jest.fn(async () => ({ paragraphs: ['synthetic report body'] }));
  jest.mocked(openGeneratedReportReader).mockResolvedValue({
    list: jest.fn(),
    read,
    readBookmarkedDiseasePossibilities: jest.fn(),
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  const documents = [
    {
      id: 'photo',
      sourceKind: 'medical_document' as const,
      ingestedAt: '2026-11-05T10:04:00Z',
      title: 'Synthetic imported photo',
      provenance: { origin: 'imported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    },
    {
      id: 'file',
      sourceKind: 'medical_document' as const,
      ingestedAt: '2026-11-05T10:02:00Z',
      title: 'Synthetic imported file',
      provenance: { origin: 'imported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    },
  ];
  const base = routeProps();
  const getDocument = jest.fn(async id => {
    const document = documents.find(value => value.id === id);
    return document ? { ...document, evidenceSpans: [] } : null;
  });
  const props = {
    ...base,
    recordings: base.recordings.slice(0, 1),
    documentImportService: {
      ...base.documentImportService!,
      listDocuments: async () => documents,
      getDocument,
    },
  };
  await renderRecords(controller, props);
  await fireEvent.press(await screen.findByTestId('records-recent-view-all'));
  await screen.findByTestId('records-recent-source-visit:synthetic');
  const buttons = screen.getAllByTestId(
    /^(medical-document-source-\d|records-recent-source-)/,
  );
  expect(buttons.map(button => button.props.testID)).toEqual([
    'medical-document-source-0',
    'records-recent-source-memory:synthetic',
    'medical-document-source-1',
    'records-recent-source-visit:synthetic',
    'records-recent-source-synthetic-0',
  ]);
  expect(screen.queryByText('synthetic memory body')).toBeNull();
  expect(screen.queryByText('synthetic report body')).toBeNull();
  expect(getDocument).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByTestId('records-recent-source-visit:synthetic'),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe(
    'generated-report-detail',
  );
  expect(await screen.findByText('synthetic report body')).toBeTruthy();
  expect(read).toHaveBeenCalledWith(report, expect.anything());

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(
    screen.getByTestId('records-recent-source-memory:synthetic'),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe(
    'saved-memory-detail',
  );
  expect(await screen.findByText('synthetic memory body')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('medical-document-source-0'));
  expect(controller.getSnapshot().currentRoute.name).toBe(
    'medical-document-detail',
  );
  expect(getDocument).toHaveBeenCalledWith('photo');
});

test('hides an uncertified audio row while the first page waits and appends the exact next cursor', async () => {
  allowSavedMaterial();
  const reports = Array.from({ length: 21 }, (_, index) => ({
    key: 'visit:' + String(30 - index),
    id: String(30 - index),
    origin: 'visit' as const,
    kind: 'visit_questions' as const,
    createdAt: '2026-11-07T09:00:00Z',
    unavailable: false,
  }));
  let release!: (rows: typeof reports) => void;
  const held = new Promise<typeof reports>(resolve => {
    release = resolve;
  });
  const load = jest.mocked(loadRecentMaterial);
  load
    .mockClear()
    .mockImplementation(before =>
      before ? Promise.resolve(reports.slice(20)) : held,
    );
  const controller = createNavigationController<AppNavigationRoute>('root');
  await renderRecords(controller, routeProps());
  expect(screen.queryByTestId('records-recent-source-synthetic-0')).toBeNull();
  expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
  await act(async () => release(reports.slice(0, 20)));
  await fireEvent.press(await screen.findByTestId('records-recent-view-all'));
  const more = await screen.findByTestId('records-recent-show-more');
  expect(screen.queryByTestId('records-recent-source-visit:10')).toBeNull();
  await fireEvent.press(more);
  expect(
    await screen.findByTestId('records-recent-source-visit:10'),
  ).toBeTruthy();
  expect(screen.getAllByTestId('records-recent-source-visit:30')).toHaveLength(
    1,
  );
  expect(load.mock.lastCall?.[0]).toEqual({
    key: 'visit:11',
    createdAt: reports[19].createdAt,
  });
});
