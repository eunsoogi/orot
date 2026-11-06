import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import App from '../App';

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
      React.useEffect(() => {
        mockConversationMount();
        return () => mockConversationUnmount();
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

test('keeps the conversation mounted underneath history and restores its draft', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  await render(<App />);
  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  await waitFor(() => expect(mockConversationMount).toHaveBeenCalledTimes(1));

  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '보존할 초안',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  expect(await screen.findByTestId('conversation-history-screen')).toBeTruthy();
  // History must push over the retained conversation in the same native stack.
  expect(screen.queryByTestId('ai-feature-overlay')).toBeNull();
  expect(mockConversationUnmount).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
      'value',
      '보존할 초안',
    ),
  );
  expect(mockConversationMount).toHaveBeenCalledTimes(1);
  expect(mockConversationUnmount).not.toHaveBeenCalled();
});
