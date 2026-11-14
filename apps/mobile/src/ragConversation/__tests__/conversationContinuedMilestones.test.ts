import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import { ownsOutcome } from '../conversationOutcomeOwnership';
import type { createConversationTurnRetention } from '../conversationTurnRetention';

/** System progress must follow real request ownership and durable completion, not a timer. */
test('milestones fence stopped and superseded requests and distinguish received from saved', async () => {
  const milestone = jest.fn();
  const execution = {
    begin: async () => true,
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
    milestone,
  };
  const turn = {
    toolMessageId: 'synthetic-turn',
    startRequest: async () => {},
    interruptRequest: async () => {},
  } as unknown as ReturnType<typeof createConversationTurnRetention>;
  const lifetime = createConversationRequestLifetime({
    execution,
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
  });
  const controller = new AbortController();
  await lifetime.start(1, controller, turn, 'synthetic question');
  lifetime.answered(controller, false);
  expect(milestone.mock.calls).toEqual([['synthetic-turn', 'answered']]);
  lifetime.answered(controller, true);
  expect(milestone.mock.calls.at(-1)).toEqual(['synthetic-turn', 'committed']);
  lifetime.interrupt(1, 'interrupted');
  const count = milestone.mock.calls.length;
  lifetime.answered(controller, true);
  expect(milestone).toHaveBeenCalledTimes(count);
  await lifetime.settle(1, controller);
  expect(execution.end).toHaveBeenCalledTimes(1);
  lifetime.answered(controller, true);
  expect(milestone).toHaveBeenCalledTimes(count);
  const old = new AbortController();
  await lifetime.start(2, old, turn, 'old');
  const newer = new AbortController();
  await lifetime.start(2, newer, turn, 'new');
  lifetime.answered(old, true);
  expect(milestone).toHaveBeenCalledTimes(count);
  await lifetime.settle(2, old);
  await lifetime.settle(2, newer);
});

test('a committed old answer never replaces a new controller owner', () => {
  expect(ownsOutcome(false, false, { committed: true })).toBe(false);
  expect(ownsOutcome(false, true, { committed: true })).toBe(true);
  expect(ownsOutcome(false, true, { summaryCommitted: true })).toBe(true);
  expect(ownsOutcome(false, true, {})).toBe(false);
  expect(ownsOutcome(true, true, {})).toBe(true);
});
