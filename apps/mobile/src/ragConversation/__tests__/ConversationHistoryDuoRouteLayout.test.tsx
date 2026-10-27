import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import * as sessionsContext from '../ConversationSessionsContext';
import { createConversationSessions } from '../conversationSessions';
import {
  clearHistoryMeasurements,
  measureHistoryHost,
  nativeGeometry,
  originalWindow,
  ProductionHistoryRoute,
  saveAnswer,
  setMeasuredHistoryHost,
  sourceReference,
  windowSize,
} from '../testSupport/conversationHistoryDuoRoute';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  clearHistoryMeasurements();
  Dimensions.set({ window: windowSize(1400) });
});
afterEach(() => Dimensions.set({ window: originalWindow }));

test('uses the production history route lane for a selected Duo preview and compact return', async () => {
  const store = createConversationSessions();
  await saveAnswer(store, '첫 대화의 합성 질문', '첫 대화의 합성 답변', [
    sourceReference,
  ]);
  store.create();
  await saveAnswer(store, '두 번째 합성 질문', '두 번째 합성 답변');
  const sessionHook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  const controller = createNavigationController<AppNavigationRoute>('home');
  controller.push('rag-conversation');
  controller.push('conversation-history');

  try {
    await render(<ProductionHistoryRoute controller={controller} />);
    const routeKey = controller.getSnapshot().currentRoute.key;
    expect(
      screen.queryByTestId(`navigation-route-columns-${routeKey}`),
    ).toBeNull();

    // The real shell reserves its 60-point rail, leaving this measured outer host.
    await measureHistoryHost(0, 1340);
    const sensor = screen.getByTestId('navigation-window-geometry-sensor');
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: nativeGeometry(1400, true),
    });

    const direction = () =>
      StyleSheet.flatten(
        screen.getByTestId('conversation-history-layout').props.style,
      )?.flexDirection;
    await waitFor(() => expect(direction()).toBe('row'));
    expect(
      StyleSheet.flatten(
        screen.getByTestId('conversation-history-layout').props.style,
      )?.width,
    ).toBe(1340);
    expect(
      StyleSheet.flatten(
        screen.getByTestId('conversation-history-layout').props.style,
      )?.columnGap,
    ).toBe(120);
    expect(
      screen.getByTestId('conversation-history-measurement-host'),
    ).toBeTruthy();
    expect(screen.getByTestId('conversation-history-preview')).toBeTruthy();
    expect(screen.getByText('두 번째 합성 답변')).toBeTruthy();

    let list = screen.getByTestId('conversation-history-list');
    await fireEvent(list, 'selectSession', { nativeEvent: { id: 1 } });
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'conversation-history',
    );
    expect(store.getSnapshot().activeId).toBe(1);
    expect(screen.getByText('첫 대화의 합성 답변')).toBeTruthy();
    expect(
      within(
        screen.getByTestId('conversation-history-preview'),
      ).queryByLabelText(/원문 근거 열기/u),
    ).toBeNull();
    expect(
      list.props.rows.find((row: { id: number }) => row.id === 1).selected,
    ).toBe(true);

    await fireEvent(list, 'createSession', { nativeEvent: {} });
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'conversation-history',
    );
    expect(
      screen.getByTestId('conversation-history-preview-empty'),
    ).toBeTruthy();

    list = screen.getByTestId('conversation-history-list');
    await fireEvent(list, 'selectSession', { nativeEvent: { id: 1 } });
    await fireEvent(list, 'deleteSession', { nativeEvent: { id: 1 } });
    expect(store.getSnapshot().activeId).toBe(2);
    expect(screen.getByText('두 번째 합성 답변')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('conversation-history-undo'));
    expect(store.getSnapshot().activeId).toBe(1);
    expect(screen.getByText('첫 대화의 합성 답변')).toBeTruthy();

    await act(async () => {
      await controller.requestBack();
    });
    expect(controller.getSnapshot().currentRoute.name).toBe('rag-conversation');

    await act(async () => {
      setMeasuredHistoryHost(0, 900);
      Dimensions.set({ window: windowSize(900) });
      await fireEvent(sensor, 'geometryChange', {
        nativeEvent: nativeGeometry(900, false),
      });
    });
    await act(async () => {
      controller.push('conversation-history');
    });
    await waitFor(() => expect(direction()).toBe('row'));
    expect(screen.getByText('첫 대화의 합성 답변')).toBeTruthy();
    const previewScroll = screen.getByTestId(
      'conversation-history-preview-messages',
    );
    await fireEvent.scroll(previewScroll, {
      nativeEvent: {
        contentOffset: { x: 0, y: 240 },
        contentSize: { width: 600, height: 1600 },
        layoutMeasurement: { width: 500, height: 720 },
      },
    });

    await act(async () => {
      Dimensions.set({ window: windowSize(900, 2) });
    });
    await waitFor(() => expect(direction()).toBe('column'));
    expect(screen.queryByTestId('conversation-history-preview')).toBeNull();

    await act(async () => {
      Dimensions.set({ window: windowSize(900) });
    });
    await waitFor(() => expect(direction()).toBe('row'));
    expect(
      screen.getByTestId('conversation-history-preview-messages').props
        .contentOffset,
    ).toEqual({ x: 0, y: 240 });

    await act(async () => {
      setMeasuredHistoryHost(0, 500);
      Dimensions.set({ window: windowSize(500) });
      await fireEvent(sensor, 'geometryChange', {
        nativeEvent: nativeGeometry(500, false),
      });
    });
    await measureHistoryHost(0, 500);
    await waitFor(() => expect(direction()).toBe('column'));

    list = screen.getByTestId('conversation-history-list');
    await fireEvent(list, 'selectSession', { nativeEvent: { id: 2 } });
    await waitFor(() =>
      expect(controller.getSnapshot().currentRoute.name).toBe(
        'rag-conversation',
      ),
    );
    expect(store.getSnapshot().activeId).toBe(2);
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});
