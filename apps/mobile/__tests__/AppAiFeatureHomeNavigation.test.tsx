import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import App from '../App';

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

afterEach(() => jest.restoreAllMocks());

test('opens conversation immediately and returns from provider and history without losing its draft', async () => {
  // Jest's native-stack does not emit UIKit transitionEnd; XCUITest covers animated completion.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  await render(<App />);

  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.queryByTestId('ai-features-screen')).toBeNull();
  expect(screen.queryByTestId('ai-feature-health-review')).toBeNull();
  expect(screen.queryByTestId('external-evidence-search')).toBeNull();
  expect(
    screen.getByText('필요하면 동의를 받고 공개 웹자료와 의학 문헌도 찾아요.'),
  ).toBeTruthy();
  expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '계속할 대화 초안',
  );
  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  expect(await screen.findByTestId('provider-selection-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
    '계속할 대화 초안',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  expect(await screen.findByTestId('conversation-history-screen')).toBeTruthy();
  expect(screen.getByTestId('conversation-saved-analysis')).toBeTruthy();
  expect(screen.getByTestId('conversation-saved-visit-questions')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
      '계속할 대화 초안',
    ),
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-new-session'));
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue('');
}, 30_000);

test('keeps recording under Records when leaving an AI route', async () => {
  // This host-level flow checks the route result; XCUITest covers UIKit animation completion.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  await render(<App />);

  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  expect(await screen.findByTestId('rag-conversation-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('rag-conversation-sessions-toggle'));
  expect(await screen.findByTestId('conversation-history-screen')).toBeTruthy();

  expect(screen.queryByTestId('navigation-recording')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-home'));
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await fireEvent.press(screen.getByTestId('records-new-recording'));

  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByTestId('ai-feature-flow')).toBeNull(),
  );
});
