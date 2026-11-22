import { resumeStatementMemoryAfterRead } from '../../memory/resumeStatementMemoryAfterRead';
import { document } from '../testSupport/recordsRouteTestProps';
import { renderRecordsRouteTest as renderRoute } from '../testSupport/renderRecordsRouteTest';
import { openGeneratedReportReader } from '../../generatedReports/readers';
import { AppState } from 'react-native';
import { loadUnifiedLocalMemories } from '../../memory/unifiedSavedMemories';
jest.mock('../../memory/unifiedSavedMemories', () => ({
  ...jest.requireActual('../../memory/unifiedSavedMemories'),
  loadUnifiedLocalMemories: jest.fn(async () => []),
}));
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { deleteMedicalDocument } from '../../medicalDocuments/medicalDocumentDeletion';
jest.mock('../../memory/resumeStatementMemoryAfterRead', () => ({
  resumeStatementMemoryAfterRead: jest.fn(),
}));
jest.mock('../../generatedReports/readers', () => ({
  openGeneratedReportReader: jest.fn(),
}));
jest.mock('../../medicalDocuments/medicalDocumentDeletion', () => ({
  deleteMedicalDocument: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

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

test('memory list opens an ID-owned native destination and returns through the controller', async () => {
  AppState.currentState = 'active';
  const text = 'Synthetic memory ' + 'long detail '.repeat(15);
  jest.mocked(loadUnifiedLocalMemories).mockResolvedValue([
    {
      id: 'synthetic-memory',
      text,
      kind: 'preference',
      createdAt: 1000,
      provenance: { sourceIds: [], reviewState: 'user_confirmed' },
    },
  ] as never);
  jest.mocked(loadUnifiedLocalMemories).mockClear();
  const controller = await renderRoute();
  expect(screen.queryByText(text)).toBeNull();
  expect(loadUnifiedLocalMemories).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('records-open-memory'));
  expect(controller.getSnapshot().currentRoute.name).toBe('manual-history');
  await fireEvent.press(
    await screen.findByTestId('saved-memory-entry-synthetic-memory'),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe(
    'saved-memory-detail',
  );
  expect(controller.getSnapshot().canGoBack).toBe(true);
  expect(await screen.findByText(text)).toBeTruthy();
  expect(JSON.stringify(controller.getSnapshot())).not.toContain(text);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(controller.getSnapshot().currentRoute.name).toBe('manual-history');
  const oldRow = await screen.findByTestId(
    'saved-memory-entry-synthetic-memory',
  );
  const queuedPress =
    oldRow.props.onStartShouldSetResponder.testOnly_pressabilityConfig()
      .onPress;
  await act(async () => {
    expect(await controller.requestBack()).toBe(true);
    // Deliver the previously queued app callback after ownership moves, before React unmount.
    queuedPress();
  });
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
  expect(screen.queryByText(text)).toBeNull();
});

test('reports row opens the protected native child; Back aborts an in-flight selected report immediately', async () => {
  AppState.currentState = 'active';
  let release!: (value: { paragraphs: string[] }) => void;
  const pending = new Promise<{ paragraphs: string[] }>(done => {
    release = done;
  });
  const row = {
    id: 'synthetic',
    key: 'summary:synthetic',
    origin: 'summary' as const,
    kind: 'possibilities' as const,
    createdAt: '2035-01-01T00:00:00Z',
    unavailable: false,
  };
  const list = jest.fn(async () => [row]);
  const read = jest.fn((_row: typeof row, _signal: AbortSignal) => pending);
  jest
    .mocked(openGeneratedReportReader)
    .mockResolvedValue({ list, read } as never);
  const controller = await renderRoute();
  expect(list).not.toHaveBeenCalled();
  expect(screen.queryByTestId('generated-report-browser')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-open-generated-reports'));
  expect(controller.getSnapshot().currentRoute.name).toBe('generated-reports');
  expect(screen.getAllByTestId('navigation-route-scroll')).toHaveLength(1);
  await fireEvent.press(
    await screen.findByTestId('generated-report-summary:synthetic'),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe(
    'generated-report-detail',
  );
  expect(screen.queryByTestId('generated-report-back')).toBeNull();
  const signal = read.mock.calls[0]![1];
  expect(signal.aborted).toBe(false);
  await act(async () => {
    const leaving = controller.requestBack();
    // The controller invalidates before the leave guard settles or React commits.
    expect(signal.aborted).toBe(true);
    release({ paragraphs: ['Synthetic confidential report body'] });
    await leaving;
  });
  expect(controller.getSnapshot().currentRoute.name).toBe('generated-reports');
  expect(screen.queryByText('Synthetic confidential report body')).toBeNull();
  expect(
    screen.getByTestId('generated-report-summary:synthetic'),
  ).toBeVisible();
  expect(list).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
  expect(screen.getByTestId('records-recent-sources')).toBeTruthy();
});

test('a held Memory list cannot publish or schedule maintenance after the controller leaves', async () => {
  AppState.currentState = 'active';
  let release!: (rows: []) => void;
  const pending = new Promise<[]>(done => {
    release = done;
  });
  jest.mocked(loadUnifiedLocalMemories).mockReturnValueOnce(pending);
  jest.mocked(resumeStatementMemoryAfterRead).mockClear();
  const controller = await renderRoute();
  await fireEvent.press(screen.getByTestId('records-open-memory'));
  expect(screen.getByTestId('saved-memory-browser')).toBeTruthy();
  expect(loadUnifiedLocalMemories).toHaveReturnedWith(pending);
  let approve!: (allowed: boolean) => void;
  const heldBack = new Promise<boolean>(done => {
    approve = done;
  });
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    () => heldBack,
  );
  await act(async () => {
    const leaving = controller.requestBack();
    expect(controller.getSnapshot().isTransitioning).toBe(true);
    try {
      release([]);
      await pending;
      await Promise.resolve();
      expect(resumeStatementMemoryAfterRead).not.toHaveBeenCalled();
    } finally {
      approve(true);
      await leaving;
    }
  });
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
  expect(screen.queryByTestId('saved-memory-browser')).toBeNull();
});
