import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';

/** Covers entry-only screens and article-launch errors through the production route. */

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

test('exposes provider selection from the feature entry', async () => {
  await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      renderVisitQuestions={() => <Text>질문 화면</Text>}
      onOpenArticle={jest.fn()}
    />,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-select-provider'));
  await waitFor(() =>
    expect(screen.getByTestId('provider-selection-screen')).toBeTruthy(),
  );
});

test('keeps next-visit questions explicitly unavailable until its screen is supplied', async () => {
  await render(<AiFeatureRoute onBack={jest.fn()} />);

  expect(screen.getByTestId('visit-questions-unavailable')).toHaveTextContent(
    '현재 진료 질문을 준비할 수 없어요.',
  );
  expect(screen.getByTestId('ai-feature-visit-questions')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  expect(screen.getByTestId('disease-hypotheses-screen')).toBeTruthy();
});

test('keeps literature inside conversation instead of exposing a standalone entry', async () => {
  const search = jest.fn();
  await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      serviceDependencies={{ externalEvidence: { search } }}
    />,
  );
  expect(screen.queryByTestId('ai-feature-external-evidence')).toBeNull();
  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  expect(
    screen.getByText('필요하면 동의를 받고 공개 의학 문헌도 찾아요.'),
  ).toBeTruthy();
  expect(search).not.toHaveBeenCalled();
});
