// Synthetic root wiring: no provider dispatch or protected database access.
jest.mock('../continuousSessionOption', () => ({
  continuousSessionOption: () => ({}),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as inferenceConsent from '../../../agent/execution/useInferenceConsent';
import { AiFeatureRoute } from '../AiFeatureRoute';

afterEach(() => jest.restoreAllMocks());
test('the real root and retained-question screen receive the full settings consent port', async () => {
  const consent = {
    authorize: jest.fn(async () => 'renewal_required' as const),
    isAuthorizationCurrent: jest.fn(() => false),
    subscribeAuthorizationInvalidation: jest.fn(() => () => {}),
  };
  jest
    .spyOn(inferenceConsent, 'useInferenceConsent')
    .mockReturnValue({ consent, disclosureSheet: null });
  const renderSaved = jest.fn(() => <Text>synthetic saved questions</Text>);
  await render(
    <AiFeatureRoute
      initialRoute="saved-visit-questions"
      onBack={jest.fn()}
      renderVisitQuestions={renderSaved}
    />,
  );
  expect(renderSaved).toHaveBeenCalledWith(
    expect.objectContaining({ consent }),
  );
  expect(consent.authorize).not.toHaveBeenCalled();
});
