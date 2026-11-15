import { NativeModules } from 'react-native';
import {
  readConversationProcessIdentity,
  isDifferentConversationProcess,
} from '../conversationProcessIdentity';
const original = NativeModules.ConversationExecutionModule;
const first = '12345678-1234-4234-8234-123456789abc';
const second = '22345678-1234-4234-8234-123456789abc';
afterEach(() => {
  NativeModules.ConversationExecutionModule = original;
});

test('only a new verified native process identity proves a different owner', async () => {
  NativeModules.ConversationExecutionModule = {
    processIdentity: async () => first,
  };
  const signal = new AbortController().signal;
  const current = await readConversationProcessIdentity(signal);
  expect(current).toBeDefined();
  expect(isDifferentConversationProcess(first, current!)).toBe(false);
  expect(isDifferentConversationProcess(second, current!)).toBe(true);
  expect(isDifferentConversationProcess(second, { ...current! })).toBe(false);
  expect(isDifferentConversationProcess('invalid', current!)).toBe(false);
  // Reading again, or recreating a JS caller, does not create a different native process.
  const again = await readConversationProcessIdentity(signal);
  expect(isDifferentConversationProcess(current!.value, again!)).toBe(false);
});

test.each([null, undefined, '', 'pid:123', 'invalid-uuid'])(
  'missing, locked or malformed native identity fails closed: %s',
  async value => {
    NativeModules.ConversationExecutionModule = {
      processIdentity: async () => value,
    };
    expect(
      await readConversationProcessIdentity(new AbortController().signal),
    ).toBeUndefined();
  },
);

test('bridge absence, rejection and late abort cannot prove owner death', async () => {
  const control = new AbortController();
  NativeModules.ConversationExecutionModule = undefined;
  expect(await readConversationProcessIdentity(control.signal)).toBeUndefined();
  NativeModules.ConversationExecutionModule = {
    processIdentity: async () => {
      throw new Error('unavailable');
    },
  };
  expect(await readConversationProcessIdentity(control.signal)).toBeUndefined();
  NativeModules.ConversationExecutionModule = {
    processIdentity: async () => {
      control.abort();
      return first;
    },
  };
  expect(await readConversationProcessIdentity(control.signal)).toBeUndefined();
});
