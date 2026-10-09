import { useEffect } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';
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

const homeFeatureRoutes = [
  ['ai-feature-visit-questions', 'home-visit-questions-screen'],
  ['ai-feature-disease-hypotheses', 'disease-hypotheses-screen'],
  ['ai-feature-rag-conversation', 'rag-conversation-screen'],
  ['ai-feature-external-evidence', 'external-medical-evidence-screen'],
] as const;

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

test('shows four explained AI actions on the welcome screen and opens each route directly', async () => {
  // Keep App and its shared navigator mounted to verify one-tap home routing.
  await render(
    <App
      renderVisitQuestions={input => (
        <VisitQuestionsHomeRouteProbe {...input} />
      )}
    />,
  );

  expect(screen.getByText('다음 진료 질문')).toBeTruthy();
  expect(screen.getByText('질환 가능성 살펴보기')).toBeTruthy();
  expect(screen.getByText('건강 기록과 대화하기')).toBeTruthy();
  expect(screen.getByText('의료 자료 찾아보기')).toBeTruthy();
  expect(
    screen.getByText(
      '건강 기록과 녹음, 다음 예약, 기억을 바탕으로 진료 때 물어볼 내용을 준비해요.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      '앱에 있는 근거와 반대 근거, 불확실한 점과 더 필요한 정보를 함께 확인해요.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      '저장된 건강 기록을 찾아 답하고, 답의 근거가 된 원문으로 이동해요.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      '직접 입력한 검색어로 외부 의료 문헌을 찾아 출처와 날짜를 확인해요.',
    ),
  ).toBeTruthy();
  expect(screen.queryByTestId('open-ai-features')).toBeNull();

  for (const [actionId, routeId] of homeFeatureRoutes) {
    await fireEvent.press(screen.getByTestId(actionId));
    expect(await screen.findByTestId(routeId)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('navigation-back'));
    await waitFor(() =>
      expect(screen.getByTestId('welcome-title')).toBeTruthy(),
    );
  }
}, 30_000);
