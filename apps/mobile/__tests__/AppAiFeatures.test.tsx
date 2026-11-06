import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../App';
import * as sessions from '../src/ragConversation/conversationSessions';

// The AI tab assertion does not exercise persistence, so native storage stays unopened.
jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
// The AI route assertion keeps backup startup native work outside this test.
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));

// Native inset behavior belongs to Simulator verification, not this unit test.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('opens conversation directly on the AI tab with the app-owned session store', async () => {
  const createSessions = jest.spyOn(sessions, 'createConversationSessions');
  await render(<App />);

  expect(createSessions).toHaveBeenCalledWith(
    expect.objectContaining({
      retention: expect.anything(),
      restoreSession: expect.any(Function),
    }),
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue('');
  expect(screen.getByTestId('ai-feature-select-provider')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-sessions-toggle')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-new-session')).toBeTruthy();
  expect(screen.queryByTestId('ai-features-screen')).toBeNull();
  expect(screen.queryByTestId('ai-feature-visit-questions')).toBeNull();
  expect(screen.queryByTestId('external-evidence-search')).toBeNull();
  expect(screen.queryByTestId('get-started')).toBeNull();
  expect(screen.queryByTestId('open-ai-features')).toBeNull();
  createSessions.mockRestore();
});
