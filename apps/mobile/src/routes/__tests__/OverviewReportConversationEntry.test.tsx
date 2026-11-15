import { Alert } from 'react-native';
import { t } from '../../i18n';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import { createConversationSessions } from '../../ragConversation/conversationSessions';

const mockStore = createConversationSessions();
jest.mock('../../ragConversation/ConversationSessionsContext', () => ({
  useConversationSessions: () => mockStore,
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../OverviewRoute', () => {
  const { Button } = require('react-native');
  return {
    __esModule: true,
    default: ({ onOpenDailyReport }: { onOpenDailyReport: () => void }) => (
      <Button title="report" onPress={onOpenDailyReport} />
    ),
  };
});

// Exercise the app callback, not a copied navigation rule; all records and services are synthetic.
test('overview prepares an inline task and selects Conversation without pushing a route', async () => {
  const selectTab = jest.fn();
  const push = jest.fn();
  const id = mockStore.getSnapshot().activeId;
  mockStore.setDraft(id, 'preserved synthetic draft');
  await render(
    <AppRouteContent
      {...({
        actions: { route: { name: 'root', key: 'root' }, push },
        activeTab: 'overview',
        selectTab,
        recordings: [],
      } as unknown as AppRouteContentProps)}
    />,
  );
  await fireEvent.press(screen.getByText('report'));
  await waitFor(() => expect(selectTab).toHaveBeenCalledWith('conversation'));
  expect(push).not.toHaveBeenCalled();
  expect(mockStore.getSnapshot().activeId).toBe(id);
  expect(mockStore.getSnapshot().sessions).toHaveLength(1);
  expect(mockStore.getSnapshot().sessions[0]).toMatchObject({
    draft: 'preserved synthetic draft',
    busy: false,
    taskCards: [{ task: { kind: 'daily_report' } }],
  });
});

test('overview reports storage failure without opening or replacing a conversation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const save = jest
    .spyOn(mockStore, 'saveTaskCard')
    .mockRejectedValue(new Error('synthetic storage failure'));
  const selectTab = jest.fn();
  const push = jest.fn();
  await render(
    <AppRouteContent
      {...({
        actions: { route: { name: 'root', key: 'root' }, push },
        activeTab: 'overview',
        selectTab,
        recordings: [],
      } as unknown as AppRouteContentProps)}
    />,
  );
  await fireEvent.press(screen.getByText('report'));
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      t('dailyReport.title'),
      t('dailyReport.entryError'),
    ),
  );
  expect(push).not.toHaveBeenCalled();
  expect(selectTab).not.toHaveBeenCalled();
  save.mockRestore();
  alert.mockRestore();
});

test('a late storage failure does not alert after leaving overview', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  const save = jest.spyOn(mockStore, 'saveTaskCard').mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const view = await render(
    <AppRouteContent
      {...({
        actions: { route: { name: 'root', key: 'root' }, push: jest.fn() },
        activeTab: 'overview',
        selectTab: jest.fn(),
        recordings: [],
      } as unknown as AppRouteContentProps)}
    />,
  );
  await fireEvent.press(screen.getByText('report'));
  await view.unmount();
  await act(async () => {
    reject(new Error('late synthetic failure'));
  });
  expect(alert).not.toHaveBeenCalled();
  save.mockRestore();
  alert.mockRestore();
});
