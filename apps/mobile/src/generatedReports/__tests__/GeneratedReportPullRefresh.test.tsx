import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionAdapter } from '../../ragConversation/conversationExecutionLease';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import {
  holdRecentTestPage,
  recentRouteProps,
  recentTestExecution,
  renderRecords,
} from '../../routes/testSupport/recentRecordsRouteTestSupport';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { loadRecentMaterial } from '../recentMaterialReader';
import { openGeneratedReportReader } from '../readers';
import type { GeneratedReportDetail, GeneratedReportRow } from '../types';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock(
  'react-native/Libraries/Components/RefreshControl/RefreshControl',
  () => {
    const React = jest.requireActual('react');
    const { View } = jest.requireActual('react-native');
    return { default: (props: object) => React.createElement(View, props) };
  },
);
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../recentMaterialReader', () => ({ loadRecentMaterial: jest.fn() }));
jest.mock('../readers', () => ({ openGeneratedReportReader: jest.fn() }));

const row: GeneratedReportRow = {
  id: 'selected',
  key: 'conversation:selected',
  origin: 'conversation',
  kind: 'possibilities',
  createdAt: '2026-11-22T19:00:00Z',
  unavailable: false,
};
const status = '현재 열 수 없는 자료예요.';
const result = (text: string, sessionVersion = 2): GeneratedReportDetail => ({
  paragraphs: [text],
  conversationSources: {
    target: {
      sessionId: 'synthetic-session',
      sessionVersion,
      turnId: row.id,
      createdAt: row.createdAt,
    },
    citations: [],
  },
});

function setup() {
  AppState.currentState = 'active';
  type Listener = Parameters<ConversationExecutionAdapter['subscribe']>[0];
  const handlers = new Set<Listener>();
  const native = {
    ...recentTestExecution,
    protectedDataAvailable: jest.fn(async () => true),
    subscribe: (handler: Listener) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  jest.mocked(conversationExecutionNative).mockReturnValue(native);
  jest.mocked(loadRecentMaterial).mockResolvedValue([row]);
  const read = jest.fn<
    Promise<GeneratedReportDetail | null>,
    [GeneratedReportRow, AbortSignal]
  >();
  jest.mocked(openGeneratedReportReader).mockResolvedValue({
    list: jest.fn(),
    read,
    readBookmarkedDiseasePossibilities: jest.fn(),
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  const detail = () => {
    const key = controller.getSnapshot().currentRoute.key;
    return within(screen.getByTestId(`navigation-route-scene-${key}`));
  };
  const control = () => detail().getByTestId('navigation-route-refresh');
  return {
    native,
    handlers,
    read,
    detail,
    control,
    pull: () =>
      act(async () => {
        control().props.onRefresh();
      }),
    open: async () => {
      await renderRecords(controller, recentRouteProps());
      await fireEvent.press(
        await screen.findByTestId('records-recent-view-all'),
      );
      await fireEvent.press(
        await screen.findByTestId(
          'records-recent-source-conversation:selected',
        ),
      );
      expect(controller.getSnapshot().currentRoute.name).toBe(
        'generated-report-detail',
      );
    },
  };
}

test('refreshes the exact saved detail selected in Recent Records while retaining its host and old body until proof', async () => {
  const f = setup();
  const fresh = holdRecentTestPage<GeneratedReportDetail>();
  f.read
    .mockResolvedValueOnce(result('Synthetic saved report'))
    .mockReturnValueOnce(fresh.promise);
  await f.open();
  await waitFor(() =>
    expect(screen.getByText('Synthetic saved report')).toBeVisible(),
  );
  const host = f.detail().getByTestId('navigation-route-scroll');
  const existingListeners = f.handlers.size;
  await f.pull();
  await f.pull();
  expect(f.control().props.refreshing).toBe(true);
  expect(f.handlers.size).toBe(existingListeners + 1);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.read.mock.calls[1]?.[0]).toEqual(row);
  expect(f.read.mock.calls[0]?.[1].aborted).toBe(true);
  expect(screen.getByText('Synthetic saved report')).toBeVisible();
  await act(async () => {
    fresh.resolve(result('Synthetic refreshed report'));
  });
  await waitFor(() =>
    expect(screen.getByText('Synthetic refreshed report')).toBeVisible(),
  );
  expect(screen.queryByText('Synthetic saved report')).toBeNull();
  expect(f.detail().getByTestId('navigation-route-scroll')).toBe(host);
  expect(f.control().props.refreshing).toBe(false);
  expect(f.handlers.size).toBe(existingListeners);
});

test('pull restarts held initialization; a late canceled result does not replace it', async () => {
  const f = setup();
  const initial = holdRecentTestPage<GeneratedReportDetail>();
  f.read
    .mockReturnValueOnce(initial.promise)
    .mockResolvedValueOnce(result('Synthetic reread'));
  await f.open();
  await waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
  await f.pull();
  expect(f.read.mock.calls[0]?.[1].aborted).toBe(true);
  await waitFor(() =>
    expect(screen.getByText('Synthetic reread')).toBeVisible(),
  );
  await act(async () => {
    initial.resolve(result('Canceled previous result'));
  });
  expect(screen.queryByText('Canceled previous result')).toBeNull();
});

test('a transient saved report read failure stays manually retryable without opening a different row', async () => {
  const f = setup();
  f.read.mockRejectedValueOnce(new Error('Synthetic local read failure'));
  f.read.mockResolvedValueOnce(result('Synthetic recovered report'));
  await f.open();
  expect(await screen.findByText('이 자료를 불러오지 못했어요.')).toBeVisible();
  expect(screen.getByTestId('generated-report-detail-retry')).toBeVisible();
  await f.pull();
  await waitFor(() =>
    expect(screen.getByText('Synthetic recovered report')).toBeVisible(),
  );
  expect(f.read.mock.calls.map(([selected]) => selected)).toEqual([row, row]);
});

test.each([
  'local deletion',
  'native lock',
  'native witness denied without an event',
  'different protected lease',
] as const)('%s never publishes a held or later retry result', async reason => {
  const f = setup();
  const late = holdRecentTestPage<GeneratedReportDetail>();
  f.read
    .mockResolvedValueOnce(result('Synthetic visible before revocation'))
    .mockReturnValueOnce(late.promise);
  await f.open();
  await screen.findByText('Synthetic visible before revocation');
  await f.pull();
  expect(f.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    if (reason === 'local deletion') notifyLocalSourceDeleted();
    if (reason === 'native lock') {
      for (const handler of f.handlers)
        handler({ kind: 'protectedData', available: false });
    }
    if (reason === 'native witness denied without an event') {
      f.native.protectedDataAvailable.mockResolvedValue(false);
      late.resolve(result('Do not publish'));
    }
    if (reason === 'different protected lease')
      late.resolve(result('Do not publish', 3));
  });
  expect(await screen.findByText(status)).toBeVisible();
  expect(f.read.mock.calls[1]?.[1].aborted).toBe(true);
  expect(f.control().props.refreshing).toBe(false);
  expect(screen.queryByText('Synthetic visible before revocation')).toBeNull();
  await f.pull();
  expect(f.read).toHaveBeenCalledTimes(2);
  await act(async () => late.resolve(result('Do not publish')));
  expect(screen.queryByText('Do not publish')).toBeNull();
});
