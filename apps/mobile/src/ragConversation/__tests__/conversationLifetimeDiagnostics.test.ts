import { waitFor } from '@testing-library/react-native';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import { conversationExecutionDiagnostics } from '../conversationExecutionDiagnostics';
import type { createConversationTurnRetention } from '../conversationTurnRetention';

async function fixture() {
  const execution = {
    bridgeAvailable: true,
    currentPhase: () => 'active' as const,
    begin: async () => true,
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  };
  const pauseState = jest.fn();
  const life = createConversationRequestLifetime({
    execution,
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
    pauseState,
  });
  const controller = new AbortController();
  const turn = {
    toolMessageId: 'private-request',
    startRequest: async () => {},
    interruptRequest: async () => {},
  } as unknown as ReturnType<typeof createConversationTurnRetention>;
  await life.start(1, controller, turn, 'private question');
  const sequence = conversationExecutionDiagnostics().at(-1)!.sequence;
  const observations = () =>
    conversationExecutionDiagnostics().filter(
      value => value.sequence === sequence,
    );
  return { life, controller, pauseState, sequence, observations };
}

test('correlates explicit Stop and lease release without identifiers or content', async () => {
  const f = await fixture();
  f.life.interrupt(1, 'cancelled');
  f.controller.abort();
  await f.life.settle(1, f.controller);
  expect(f.observations().map(value => value.event)).toEqual([
    'begin',
    'acquired',
    'user-stop',
    'release',
  ]);
  expect(
    f.observations().find(value => value.event === 'user-stop')?.reason,
  ).toBe('user-stopped');
  expect(JSON.stringify(f.observations())).not.toContain('private');
});

test('records only the actual current failure category and ignores late outcomes', async () => {
  const f = await fixture();
  f.life.outcome(f.controller, {
    status: 'failure',
    kind: 'provider_unavailable',
  });
  expect(f.observations().at(-1)?.outcome).toBe('provider_unavailable');
  f.life.outcome(f.controller, { status: 'failure', kind: 'retrieval_failed' });
  expect(f.observations().at(-1)?.outcome).toBe('retrieval_failed');
  f.life.outcome(f.controller, { status: 'unavailable' });
  expect(f.observations().at(-1)?.outcome).toBe('unavailable');
  await f.life.settle(1, f.controller);
  const length = f.observations().length;
  f.life.outcome(f.controller, { status: 'failure', kind: 'provider_refused' });
  expect(f.observations()).toHaveLength(length);
});

test('safe pause and explicit continuation retain the same diagnostic sequence', async () => {
  const f = await fixture();
  const waiting = f.life.executionObserver(f.controller).onWorkflowPaused();
  await waitFor(() => expect(f.pauseState).toHaveBeenCalled());
  f.pauseState.mock.calls.at(-1)![1]();
  await expect(waiting).resolves.toBe(true);
  expect(
    f.observations().filter(value => value.event === 'begin'),
  ).toHaveLength(2);
  expect(conversationExecutionDiagnostics().at(-1)?.sequence).toBe(f.sequence);
  await f.life.settle(1, f.controller);
});
