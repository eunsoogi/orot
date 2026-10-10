import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { ExternalMedicalPublication } from '../../../externalMedicalEvidence/europePmc';

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

test('shows an error when the selected external article cannot be opened', async () => {
  const publication: ExternalMedicalPublication = {
    provider: 'Europe PMC',
    recordId: '12345',
    source: 'MED',
    title: 'A sourced article',
    authors: null,
    journal: null,
    publicationDate: null,
    updatedDate: null,
    abstract: null,
    originalUrl: 'https://europepmc.org/article/MED/12345',
    retrievedAt: '2026-10-08T00:00:00.000Z',
  };
  const externalEvidence = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    })),
  };
  const onOpenArticle = jest.fn(async () => {
    throw new Error('No browser is available.');
  });
  await render(
    <AiFeatureRoute
      onBack={jest.fn()}
      onOpenArticle={onOpenArticle}
      serviceDependencies={{ externalEvidence }}
    />,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  await fireEvent.press(screen.getByTestId('external-evidence-consent'));
  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'blood pressure',
  );
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  expect(await screen.findByText(publication.title)).toBeTruthy();
  await fireEvent.press(screen.getByText('원문 열기'));

  expect(
    await screen.findByTestId('external-article-open-error'),
  ).toHaveTextContent('외부 문헌을 열지 못했어요. 링크를 확인해 주세요.');
  expect(onOpenArticle).toHaveBeenCalledWith(publication);
});
