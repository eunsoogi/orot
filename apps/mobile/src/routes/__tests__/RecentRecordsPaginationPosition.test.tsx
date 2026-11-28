import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { RecentMaterialRow } from '../../generatedReports/catalog';
import { loadRecentMaterial } from '../../generatedReports/recentMaterialReader';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { AppNavigationRoute } from '../appNavigationRoute';
import {
  holdRecentTestPage,
  pendingVisitReports,
  recentRouteProps,
  recentTestExecution,
  renderRecords,
} from '../testSupport/recentRecordsRouteTestSupport';

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

test('a pending next page keeps incumbent rows and More ahead of pagination feedback', async () => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
  const reports = pendingVisitReports();
  const next = holdRecentTestPage<RecentMaterialRow[]>();
  const read = jest.mocked(loadRecentMaterial);
  read.mockImplementation(before =>
    before ? next.promise : Promise.resolve(reports.slice(0, 20)),
  );
  const controller = createNavigationController<AppNavigationRoute>('root');
  await renderRecords(controller, recentRouteProps());
  await fireEvent.press(await screen.findByTestId('records-recent-view-all'));
  const scroll = screen.getByTestId('navigation-route-scroll');
  const existing = screen.getAllByTestId(/^records-recent-source-visit:/);
  const more = await screen.findByTestId('records-recent-show-more');
  expect(existing).toHaveLength(20);

  await fireEvent.press(more);
  await waitFor(() =>
    expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy(),
  );
  expect(
    screen.queryByTestId('records-recent-skeleton', {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  const beforeAppend = screen.getAllByTestId(
    /^records-recent-(?:source-visit:|show-more$|sources-loading$)/,
  );
  expect(beforeAppend.map(node => node.props.testID)).toEqual([
    ...existing.map(node => node.props.testID),
    'records-recent-show-more',
    'records-recent-sources-loading',
  ]);
  expect(screen.getByTestId('navigation-route-scroll')).toBe(scroll);
  expect(screen.getByTestId('records-recent-show-more')).toBe(more);

  await act(async () => next.resolve(reports.slice(20)));
  const after = screen.getAllByTestId(/^records-recent-source-visit:/);
  expect(after).toHaveLength(21);
  existing.forEach((node, index) => expect(after[index]).toBe(node));
  expect(after[20]?.props.testID).toBe('records-recent-source-visit:10');
  expect(screen.getByTestId('navigation-route-scroll')).toBe(scroll);
  expect(read.mock.calls.filter(([cursor]) => !!cursor)).toHaveLength(1);
});
