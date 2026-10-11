import { useEffect } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import App from '../App';
import type { VisitQuestionsRenderInput } from '../src/aiFeatures/integration/AiFeatureFlowScreen';

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

const aiFeatureRoutes = [
  ['ai-feature-visit-questions', 'home-visit-questions-screen'],
  ['ai-feature-disease-hypotheses', 'disease-hypotheses-screen'],
  ['ai-feature-rag-conversation', 'rag-conversation-screen'],
  ['ai-feature-external-evidence', 'external-medical-evidence-screen'],
] as const;

afterEach(() => jest.restoreAllMocks());

function VisitQuestionsHomeRouteProbe({
  onRouteStateChange,
}: VisitQuestionsRenderInput) {
  useEffect(() => {
    // The injected route reports a clean state so guarded Back matches the real screen contract.
    onRouteStateChange({
      hasUnsavedChanges: false,
      isSaving: false,
      isGenerating: false,
      revision: 0,
    });
  }, [onRouteStateChange]);

  return <Text testID="home-visit-questions-screen">다음 진료 질문 화면</Text>;
}

test('shows four explained AI actions on the AI tab and opens each route directly', async () => {
  // Jest's native-stack does not emit UIKit transitionEnd; Detox covers animated completion.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  // Keep App and its shared navigator mounted to verify one-tap home routing.
  await render(
    <App
      renderVisitQuestions={input => (
        <VisitQuestionsHomeRouteProbe {...input} />
      )}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  expect(screen.getByText('다음 진료 질문')).toBeTruthy();
  expect(screen.getByText('증상 정리')).toBeTruthy();
  expect(screen.getByText('기록과 대화')).toBeTruthy();
  expect(screen.getByText('의학 자료 찾기')).toBeTruthy();
  expect(screen.getByText('궁금한 점을 정리해요.')).toBeTruthy();
  expect(screen.getByText('지금 느끼는 증상을 정리해요.')).toBeTruthy();
  expect(screen.getByText('내 기록을 바탕으로 질문해요.')).toBeTruthy();
  expect(screen.getByText('의학 자료를 찾아보세요.')).toBeTruthy();
  expect(screen.queryByTestId('open-ai-features')).toBeNull();

  for (const [actionId, routeId] of aiFeatureRoutes) {
    await fireEvent.press(screen.getByTestId(actionId));
    expect(await screen.findByTestId(routeId)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-features-screen')).toBeTruthy(),
    );
  }
}, 30_000);

test('keeps recording under Records when leaving an AI route', async () => {
  // This host-level flow checks the route result; native animation completion is covered in Detox.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  await render(
    <App
      renderVisitQuestions={input => (
        <VisitQuestionsHomeRouteProbe {...input} />
      )}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  expect(await screen.findByTestId('disease-hypotheses-screen')).toBeTruthy();

  expect(screen.queryByTestId('navigation-recording')).toBeNull();
  await fireEvent.press(screen.getByTestId('navigation-home'));
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await fireEvent.press(screen.getByTestId('records-new-recording'));

  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByTestId('ai-feature-flow')).toBeNull(),
  );
});
