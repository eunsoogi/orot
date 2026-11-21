import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import App from '../App';
import * as shellServices from '../src/routes/AppConversationScene';
import * as routeContent from '../src/routes/AppRouteContent';
import * as sessionOptions from '../src/aiFeatures/integration/conversationSessionOptions';
import { setup } from '../src/ragConversation/testSupport/continuousSessionFixture';
import { createAppointmentStore } from '../test-helpers/appointmentStore';
import type { ConversationHistoryPage } from '../src/ragConversation/conversationHistoryPage';

const mockConversationMount = jest.fn();
const mockConversationUnmount = jest.fn();

jest.mock('../src/ragConversation/ConversationScreen', () => {
  const React = require('react') as typeof import('react');
  const actual = jest.requireActual(
    '../src/ragConversation/ConversationScreen',
  );
  return {
    ...actual,
    ConversationScreen: (props: Record<string, unknown>) => {
      const instance = React.useRef(Symbol('conversation-instance'));
      React.useEffect(() => {
        const identity = instance.current;
        mockConversationMount(identity);
        return () => mockConversationUnmount(identity);
      }, []);
      return React.createElement(actual.ConversationScreen, props);
    },
  };
});

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  mockConversationMount.mockClear();
  mockConversationUnmount.mockClear();
});
afterEach(() => jest.restoreAllMocks());

test('keeps the conversation mounted underneath provider selection and restores its draft', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  await render(<App />);
  await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
  await waitFor(() => expect(mockConversationMount).toHaveBeenCalledTimes(1));

  const originalInstance = mockConversationMount.mock.calls[0]?.[0];
  const originalInput = screen.getByTestId('rag-conversation-input');
  await fireEvent.changeText(originalInput, '보존할 초안');
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('provider-selection-screen')).toBeTruthy();
  // Provider selection must push over the retained conversation in the same native stack.
  expect(screen.queryByTestId('ai-feature-overlay')).toBeNull();
  expect(mockConversationUnmount).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
      'value',
      '보존할 초안',
    ),
  );
  expect(screen.getByTestId('rag-conversation-input')).toBe(originalInput);
  expect(mockConversationUnmount).not.toHaveBeenCalledWith(originalInstance);
});

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}

test('App navigation and its shell do not wait for or rerender on held route data publication', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const phase = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const fixture = await setup();
  const history = gate<ConversationHistoryPage>();
  const appointments =
    gate<ReturnType<typeof createAppointmentStore>['repository']>();
  const recordings = gate<[]>();
  const readHistory = jest.fn(
    (_id: string, _signal: AbortSignal) => history.promise,
  );
  const shellRender = jest.spyOn(shellServices, 'useAppAiServices');
  jest
    .spyOn(sessionOptions, 'createConversationSessionOptions')
    .mockReturnValue({
      ...fixture.options,
      restoreSessionPage: readHistory,
    });
  const app = await render(
    <App
      loadAppointments={() => appointments.promise}
      loadRecordings={() => recordings.promise}
    />,
  );
  try {
    await waitFor(() => expect(readHistory).toHaveBeenCalled());
    expect(screen.getByTestId('conversation-history-restoring')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-floating-identity'));
    expect(
      await screen.findByTestId('assistant-appearance-scroll'),
    ).toBeTruthy();
    const duringSettings = shellRender.mock.calls.length;
    await act(async () =>
      appointments.resolve(createAppointmentStore([]).repository),
    );
    expect(shellRender).toHaveBeenCalledTimes(duringSettings);
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByTestId('assistant-appearance-scroll')).toBeNull();
    expect(
      await screen.findByTestId('conversation-history-restoring'),
    ).toBeTruthy();
    const reader = readHistory.mock.calls.at(-1)?.[1];
    expect(reader?.aborted).toBe(false);
    await fireEvent.press(screen.getByTestId('navigation-tab-records'));
    expect(await screen.findByTestId('records-title')).toBeTruthy();
    // The outgoing root must not start a false restore entry before Records commits.
    expect(reader?.aborted).toBe(false);
    const duringRecords = shellRender.mock.calls.length;
    await act(async () => recordings.resolve([]));
    expect(shellRender).toHaveBeenCalledTimes(duringRecords);
    await act(async () =>
      history.resolve({
        turns: [],
        taskCards: [],
        nextCursor: null,
      }),
    );
    await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
    expect(await screen.findByTestId('rag-conversation-screen')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByTestId('conversation-history-restoring')).toBeNull(),
    );
  } finally {
    await act(async () => {
      history.resolve({ turns: [], taskCards: [], nextCursor: null });
      appointments.resolve(createAppointmentStore([]).repository);
      recordings.resolve([]);
    });
    await app.unmount();
    if (phase) Object.defineProperty(AppState, 'currentState', phase);
    fixture.store.dispose();
    fixture.close();
  }
});

test('appointment-only publication does not rerender the real Records route', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const appointments =
    gate<ReturnType<typeof createAppointmentStore>['repository']>();
  const recordings = gate<[]>();
  const scenes = jest.spyOn(routeContent, 'AppRouteContent');
  const readRecords = () =>
    scenes.mock.calls.filter(
      ([props]) =>
        props.actions.route.name === 'root' && props.activeTab === 'records',
    );
  const app = await render(
    <App
      loadAppointments={() => appointments.promise}
      loadRecordings={() => recordings.promise}
    />,
  );
  try {
    await fireEvent.press(screen.getByTestId('navigation-tab-records'));
    expect(await screen.findByTestId('records-title')).toBeTruthy();
    const before = readRecords().length;
    expect(readRecords().at(-1)?.[0].recordingState).toBe('loading');
    await act(async () =>
      appointments.resolve(createAppointmentStore([]).repository),
    );
    expect(readRecords()).toHaveLength(before);
    await act(async () => recordings.resolve([]));
    expect(readRecords().at(-1)?.[0].recordingState).toBe('ready');
  } finally {
    await act(async () => {
      appointments.resolve(createAppointmentStore([]).repository);
      recordings.resolve([]);
    });
    await app.unmount();
  }
});
