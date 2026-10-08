import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../App';

// This route test does not exercise storage, so native persistence stays unopened.
jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
// The integration test keeps backup startup native work outside this route assertion.
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));

// Native inset behavior belongs to Simulator verification, not this unit test.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('opens the Korean AI feature menu and returns to the welcome screen', async () => {
  await render(<App />);

  expect(screen.getByTestId('open-ai-features')).toHaveTextContent(
    'AI 건강 기능 살펴보기',
  );
  expect(screen.queryByTestId('get-started')).toBeNull();
  await fireEvent.press(screen.getByTestId('open-ai-features'));

  expect(screen.getByTestId('ai-features-screen')).toBeTruthy();
  expect(screen.getByText('질환 가능성 살펴보기')).toBeTruthy();
  expect(screen.getByText('건강 기록과 대화하기')).toBeTruthy();
  expect(screen.getByText('의료 자료 찾아보기')).toBeTruthy();
  expect(screen.getByTestId('ai-feature-visit-questions')).toBeDisabled();
  expect(screen.getByText('현재 진료 질문을 준비할 수 없어요.')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('ai-feature-back'));
  expect(screen.getByTestId('welcome-title')).toBeTruthy();
});
