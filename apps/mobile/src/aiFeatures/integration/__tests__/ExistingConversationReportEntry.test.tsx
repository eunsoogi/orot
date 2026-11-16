import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AiFeatureFlow } from '../AiFeatureFlow';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { createAiFeatureServices } from '../featureServices';

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

test('report request stays in the existing conversation with its draft and one inline task', async () => {
  const push = jest.fn();
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlow
        consent={consent}
        services={createAiFeatureServices(consent)}
        isEntryCurrent={() => true}
        onOpenArticle={jest.fn()}
        navigation={{
          route: { name: 'rag-conversation', key: 'root' },
          push,
          replace: jest.fn(),
          onBack: jest.fn(),
          onHome: jest.fn(),
          registerLeaveState: () => () => {},
        }}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'keep my synthetic draft',
  );
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  expect(await screen.findByTestId('inline-daily-report-task')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
    'value',
    'keep my synthetic draft',
  );
  expect(screen.queryByTestId('daily-report-screen')).toBeNull();
  expect(screen.queryByTestId('rag-conversation-progress')).toBeNull();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  expect(screen.getAllByTestId('inline-daily-report-task')).toHaveLength(1);
  expect(push).not.toHaveBeenCalled();
  expect(consent.authorize).not.toHaveBeenCalled();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
    'value',
    'keep my synthetic draft',
  );
});

test('a single report-choice tap starts the same consent-aware inline workflow without a second generate tap', async () => {
  const consent = {
    authorize: jest.fn(async () => 'renewal_required' as const),
  };
  const start = jest.fn(() => ({
    status: 'started' as const,
    cancel: jest.fn(),
    result: Promise.resolve({
      status: 'failed' as const,
      code: 'consent_required',
    }),
  }));
  const services = createAiFeatureServices(consent);
  const feature = {
    lookup: jest.fn(async () => ({ status: 'missing' })),
    preview: jest.fn(async () => ({ status: 'not_today' })),
    start,
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as NonNullable<typeof services.dailyReport>;
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlow
        consent={consent}
        services={{ ...services, dailyReport: feature }}
        isEntryCurrent={() => true}
        onOpenArticle={jest.fn()}
        navigation={{
          route: { name: 'rag-conversation', key: 'root' },
          push: jest.fn(),
          replace: jest.fn(),
          onBack: jest.fn(),
          onHome: jest.fn(),
          registerLeaveState: () => () => {},
        }}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  expect(start).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start).toHaveBeenCalledTimes(1);
  expect(screen.getAllByTestId('inline-daily-report-task')).toHaveLength(1);
});
