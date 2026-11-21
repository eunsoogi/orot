import { NativeModules } from 'react-native';
import { markConversationInput } from '../../providers/conversationInputDiagnostic';
import { conversationDispatch } from '../conversationDispatch';
import { immediateConversationChoices } from '../immediateConversationChoices';
import type { ConversationSessions } from '../conversationSessions';
import type { ConversationSession } from '../conversationSessionTypes';

const sink = () => NativeModules.OrotProviderDiagnostics;
const prior = Object.getOwnPropertyDescriptor(
  NativeModules,
  'OrotProviderDiagnostics',
);
function setSink(value: unknown) {
  Object.defineProperty(NativeModules, 'OrotProviderDiagnostics', {
    configurable: true,
    value,
  });
}
afterEach(() => {
  if (prior)
    Object.defineProperty(NativeModules, 'OrotProviderDiagnostics', prior);
  else delete NativeModules.OrotProviderDiagnostics;
});

test('input probe independently fails closed for missing, disabled, and throwing native sinks', () => {
  const report = jest.fn();
  setSink(undefined);
  markConversationInput('conversation_quick_press');
  setSink({ enabled: false, report });
  markConversationInput('conversation_quick_press');
  expect(report).not.toHaveBeenCalled();
  setSink({
    get enabled() {
      throw new Error('synthetic flag failure');
    },
    report,
  });
  expect(() => markConversationInput('conversation_quick_press')).not.toThrow();
  setSink({
    enabled: true,
    report: () => {
      throw new Error('synthetic report failure');
    },
  });
  expect(() =>
    markConversationInput('conversation_send_preparing'),
  ).not.toThrow();
  expect(sink()).toBeDefined();
});

test.each([false, true])(
  'accepted quick choice marks press before selection and state publication before protected reads (sink throws: %s)',
  async shouldThrow => {
    let live = false;
    const order: unknown[] = [];
    const hit = jest.fn((...args: unknown[]) => {
      order.push(args);
      if (shouldThrow) throw new Error('synthetic sink');
    });
    setSink({ enabled: true, report: hit });
    let session = { id: 1, draft: '' } as ConversationSession;
    const send = jest.fn(async () => {});
    const beforeSend = jest.fn(() => {
      order.push('before-send');
      return new Promise<boolean>(() => {});
    });
    const photoDrafts = {
      get: () => ({ status: 'empty' }),
    } as unknown as Parameters<typeof conversationDispatch>[0]['photoDrafts'];
    const dispatch = conversationDispatch({
      requests: { send } as unknown as Parameters<
        typeof conversationDispatch
      >[0]['requests'],
      photoDrafts,
      retention: undefined,
      disposed: () => false,
      find: () => session,
      update: (_id, change) => {
        session = { ...session, ...change };
        if (change.preparingSend) order.push('preparing-published');
      },
      current: () => live,
      beforeSend,
    });
    const store = {
      getSnapshot: () => ({ activeId: 1, sessions: [session] }),
      photoDrafts,
      sendPrompt: dispatch.sendPrompt,
    } as unknown as ConversationSessions;
    const choose = () => {
      order.push('choice-selected');
      session = { ...session, entryPrompt: 'Never logged synthetic content' };
    };
    const sendAnswer = async () => ({ status: 'insufficient' as const });
    const quick = immediateConversationChoices(
      store,
      1,
      { healthSummary: choose },
      sendAnswer,
      undefined,
      () => live,
    )!.healthSummary!;
    quick();
    expect(order).toEqual([]);
    live = true;
    quick();
    quick(); // A duplicate press on the pending request cannot create a new timing mark.
    expect(order).toEqual([
      ['rag', 'conversation_quick_press', 'completed'],
      'choice-selected',
      'preparing-published',
      ['rag', 'conversation_send_preparing', 'completed'],
      'before-send',
    ]);
    expect(session.preparingSend).toBe(true);
    expect(send).not.toHaveBeenCalled();
    dispatch.cancelBeforeSend(1);
    expect(session.preparingSend).toBe(false);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  },
);
