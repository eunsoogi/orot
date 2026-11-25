import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  listRecentMaterial,
  type RecentMaterialRow,
} from '../../generatedReports/catalog';
import { loadRecentMaterial } from '../../generatedReports/recentMaterialReader';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionAdapter } from '../../ragConversation/conversationExecutionLease';
import { readCommittedRecentSourcePage } from '../../storage/committedRecentSourcePage';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { loadRecentSourceMaterial } from '../recentSourceReader';
import {
  holdRecentTestPage,
  pendingVisitReports,
  recentRouteProps,
  recentTestExecution,
  renderRecords,
  seedIndexedRecentSources,
} from '../testSupport/recentRecordsRouteTestSupport';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The RN Jest preset drops RefreshControl's native props. Keep the JS contract observable.
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
jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(),
}));
jest.mock('../recentSourceReader', () => ({
  loadRecentSourceMaterial: jest.fn(),
  readSelectedRecentRecording: jest.fn(),
}));

const reports = jest.mocked(loadRecentMaterial);
const media = jest.mocked(loadRecentSourceMaterial);
const control = () => screen.getByTestId('navigation-route-refresh');
const report = (id: string) => 'records-recent-source-visit:' + id;
const refresh = () =>
  act(async () => {
    // UIKit starts the action without waiting for the protected reads.
    control().props.onRefresh();
  });

beforeEach(() => {
  reports.mockReset();
  media.mockReset();
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
  media.mockResolvedValue([]);
});
async function openTimeline(props = recentRouteProps()) {
  const controller = createNavigationController<AppNavigationRoute>('root');
  await renderRecords(controller, props, true);
  expect(screen.queryByTestId('navigation-route-refresh')).toBeNull();
  await fireEvent.press(await screen.findByTestId('records-recent-view-all'));
  expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');
  return controller;
}

test('one pull retires held More and replaces both first pages in the same ScrollView', async () => {
  const fixture = openInterleavableRecentSourceDatabase();
  const next = holdRecentTestPage<RecentMaterialRow[]>();
  const expired = holdRecentTestPage<RecentMaterialRow[]>();
  const old = pendingVisitReports().slice(0, 20);
  const newer = {
    ...old[0]!,
    id: 'fresh',
    key: 'visit:fresh',
    createdAt: '2026-11-22T10:01:00Z',
  };
  let refreshing = false;
  let moreSignal: AbortSignal | undefined;
  try {
    await runMigrations(fixture.database);
    const props = recentRouteProps();
    const records = createRecordRepository(fixture.database);
    const audio = await seedIndexedRecentSources(
      records,
      props.recordings[0]!,
      '2026-11-22T09:30:00Z',
    );
    media.mockImplementation(async before =>
      (
        await readCommittedRecentSourcePage(
          fixture.database,
          before && { id: before.key, createdAt: before.createdAt },
        )
      ).map(row => ({ ...row, key: row.id })),
    );
    reports.mockImplementation(async (before, options) => {
      if (before) {
        moreSignal = options?.signal;
        return expired.promise;
      }
      return refreshing ? next.promise : old;
    });
    await openTimeline({ ...props, documentImportService: undefined });
    const host = screen.getByTestId('navigation-route-scroll');
    const previous = await screen.findByTestId(report('30'));
    await fireEvent.press(screen.getByTestId('records-recent-show-more'));
    await waitFor(() => expect(moreSignal).toBeDefined());
    await records.put('source_record', {
      ...audio,
      id: 'audio-fresh',
      recordedAt: '2026-11-22T10:00:00Z',
      ingestedAt: '2026-11-22T10:00:00Z',
    });
    refreshing = true;
    reports.mockClear();
    media.mockClear();
    await refresh();
    await refresh();
    expect(moreSignal?.aborted).toBe(true);
    expect(reports).toHaveBeenCalledTimes(1);
    expect(reports.mock.lastCall?.[0]).toBeUndefined();
    expect(media).toHaveBeenCalledTimes(1);
    expect(media.mock.lastCall?.[0]).toBeUndefined();
    await act(async () => {
      await media.mock.results[0]?.value;
    });
    expect(screen.getByTestId(report('30'))).toBe(previous);
    expect(
      screen.queryByTestId('records-recent-source-audio-fresh'),
    ).toBeNull();
    expect(control().props.refreshing).toBe(true);
    await act(async () => {
      next.resolve([newer]);
    });
    const rows = screen.getAllByTestId(
      /^(records-recent-source-(visit:|audio-)|medical-document-source-)/,
    );
    expect(rows).toHaveLength(20);
    expect(rows.slice(0, 2).map(row => row.props.testID)).toEqual([
      report('fresh'),
      'records-recent-source-audio-fresh',
    ]);
    expect(screen.getByTestId('navigation-route-scroll')).toBe(host);
    expect(control().props.refreshing).toBe(false);
    await act(async () => {
      expired.resolve(old.slice(0, 1));
    });
    expect(screen.queryByTestId(report('30'))).toBeNull();
  } finally {
    fixture.close();
  }
});
test('failed refresh keeps rows and manual Retry refreshes both first pages', async () => {
  const first = pendingVisitReports().slice(0, 1);
  reports.mockResolvedValue(first);
  await openTimeline();
  const held = holdRecentTestPage<never[]>();
  media.mockClear().mockImplementationOnce(() => held.promise);
  reports
    .mockClear()
    .mockRejectedValueOnce(new Error('synthetic local read failure'));
  reports.mockResolvedValueOnce([
    { ...first[0]!, id: 'retried', key: 'visit:retried' },
  ]);
  await refresh();
  expect(screen.getByTestId(report('30'))).toBeTruthy();
  expect(control().props.refreshing).toBe(false);
  expect(media.mock.lastCall?.[1]?.signal.aborted).toBe(true);
  await fireEvent.press(
    await screen.findByTestId('records-recent-partial-retry'),
  );
  expect(await screen.findByTestId(report('retried'))).toBeTruthy();
  expect(screen.queryByTestId(report('30'))).toBeNull();
  expect(reports.mock.calls.map(([cursor]) => cursor)).toEqual([
    undefined,
    undefined,
  ]);
  expect(media.mock.calls.map(([cursor]) => cursor)).toEqual([
    undefined,
    undefined,
  ]);
  await act(async () => held.resolve([]));
});

test('native protection loss cancels the shared refresh and clears the old prefix', async () => {
  let protectedData = true;
  type Listener = Parameters<ConversationExecutionAdapter['subscribe']>[0];
  const handlers = new Set<Listener>();
  jest.mocked(conversationExecutionNative).mockReturnValue({
    ...recentTestExecution,
    protectedDataAvailable: async () => protectedData,
    subscribe: handler => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  });
  const first = pendingVisitReports().slice(0, 1);
  reports.mockResolvedValue(first);
  await openTimeline();
  const held = holdRecentTestPage<RecentMaterialRow[]>();
  reports.mockImplementationOnce(() => held.promise);
  await refresh();
  const signal = reports.mock.lastCall?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    protectedData = false;
    for (const handler of handlers)
      handler({ kind: 'protectedData', available: false });
  });
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByTestId(report('30'))).toBeNull();
  expect(control().props.refreshing).toBe(false);
  await act(async () => held.resolve(first));
  expect(screen.queryByTestId(report('30'))).toBeNull();
});

test('a retired report page never starts its catalog query after SQLite schema discovery', async () => {
  const lock = new AbortController();
  const observed: string[] = [];
  let observing = false;
  const fixture = openInterleavableRecentSourceDatabase(async sql => {
    if (observing) {
      observed.push(sql);
      lock.abort();
    }
  });
  try {
    await runMigrations(fixture.database);
    observing = true;
    await expect(
      listRecentMaterial(fixture.database, undefined, lock.signal),
    ).resolves.toEqual([]);
    expect(observed).toEqual([
      "SELECT name FROM sqlite_master WHERE type='table'",
    ]);
  } finally {
    fixture.close();
  }
});
