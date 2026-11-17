import { act, renderHook } from '@testing-library/react-native';
import type { SafetyPolicyInput } from '@orot/domain';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import { dispatchExplicitTreatmentAction } from '../../ragConversation/conversationVisitDispatch';
import { treatmentConversationSender } from '../treatmentConversationSender';
import { useTreatmentConversationAction } from '../useTreatmentConversationAction';

jest.mock('../../ragConversation/conversationVisitDispatch', () => ({
  dispatchExplicitTreatmentAction: jest.fn(),
}));
jest.mock('../treatmentConversationSender', () => ({
  treatmentConversationSender: jest.fn(),
}));
jest.mock('../TreatmentLibraryChoices', () => ({
  openTreatmentDatabase: jest.fn(),
}));

const dispatch = jest.mocked(dispatchExplicitTreatmentAction);
const sender = jest.mocked(treatmentConversationSender);
beforeEach(() => jest.clearAllMocks());

test.each([
  { callback: true, answer: true, verified: true },
  { callback: false, answer: true, verified: false },
  { callback: true, answer: false, verified: false },
])(
  'source verification requires both callback and answer: %j',
  async scenario => {
    dispatch.mockImplementation(async () => {
      if (scenario.callback)
        sender.mock.calls[0]?.[0].presentation?.onVerified?.([], []);
      return scenario.answer
        ? { status: 'answer', answer: 'Synthetic guidance', citations: [] }
        : { status: 'failure', kind: 'validation_failed' };
    });
    const sessions = createConversationSessions();
    const { result } = await renderHook(() =>
      useTreatmentConversationAction({
        ownership: sessions.treatment,
        sessionId: 1,
        onOpenSource: jest.fn(),
      }),
    );
    // Policy is evaluated by the real sender in separate SQLite/safety suites.
    await act(async () =>
      result.current.submit({} as SafetyPolicyInput, false),
    );
    expect(result.current.result?.verified).toBe(scenario.verified);
    if (scenario.answer)
      expect(result.current.result?.answer).toBe('Synthetic guidance');
    expect(result.current.pending).toBeNull();
  },
);
