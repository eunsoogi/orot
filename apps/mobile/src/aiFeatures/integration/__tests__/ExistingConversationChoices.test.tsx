import { conversationIntentRequests } from '../conversationIntent';
import { fireEvent, render, screen } from '@testing-library/react-native';
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

test.each([
  ['conversation-open-possibilities', 'possibilities'],
  ['conversation-open-visit-questions', 'visit-questions'],
  ['conversation-open-health-summary', 'health-summary'],
] as const)(
  'keeps %s inside the current conversation',
  async (button, intent) => {
    const push = jest.fn();
    const consent = { authorize: jest.fn(async () => 'authorized' as const) };
    const send = jest.fn().mockResolvedValue({ status: 'no_evidence' });
    const prepare = jest.fn().mockResolvedValue({ status: 'no_evidence' });
    await render(
      <AiFeatureSharedNavigationStateProvider>
        <AiFeatureFlow
          consent={consent}
          services={{
            ...createAiFeatureServices(consent),
            sendRagMessage: send,
            prepareVisitQuestionTurn: prepare,
          }}
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
    const input = screen.getByTestId('rag-conversation-input');
    await fireEvent.changeText(input, 'Existing draft');
    expect(screen.getByTestId(button)).toBeDisabled();
    await fireEvent.press(screen.getByTestId(button));
    expect(input).toHaveProp('value', 'Existing draft');
    await fireEvent.changeText(input, '');
    await fireEvent.press(screen.getByTestId(button));
    expect(screen.getByTestId('rag-conversation-input')).toBe(input);
    expect(push).not.toHaveBeenCalled();
    expect(consent.authorize).not.toHaveBeenCalled();
    if (intent === 'visit-questions') {
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ intent }),
        }),
      );
    } else {
      expect(send).toHaveBeenCalledTimes(1);
      expect(prepare).not.toHaveBeenCalled();
      expect(input).toHaveProp('value', '');
      expect(send).toHaveBeenCalledWith(
        conversationIntentRequests[intent],
        expect.any(Array),
        expect.any(AbortSignal),
        expect.any(Object),
        expect.objectContaining({ intent }),
      );
    }
    expect(push).not.toHaveBeenCalled();
  },
);
