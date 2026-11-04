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

test('shows the AI feature actions on the AI tab', async () => {
  const createSessions = jest.spyOn(sessions, 'createConversationSessions');
  await render(<App />);

  expect(createSessions).toHaveBeenCalledWith(
    expect.objectContaining({
      retention: expect.anything(),
      restoreSession: expect.any(Function),
    }),
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  expect(screen.getByTestId('ai-features-screen')).toBeTruthy();
  expect(screen.getByText('다음 진료 질문')).toBeTruthy();
  expect(screen.getByTestId('ai-feature-visit-questions')).toBeEnabled();
  expect(screen.queryByTestId('get-started')).toBeNull();
  expect(screen.queryByTestId('open-ai-features')).toBeNull();
  createSessions.mockRestore();
});
