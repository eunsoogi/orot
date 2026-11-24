import {
  adoptContinuedConversationLease,
  continuedOpportunityObserver,
  createContinuedRequestOwners,
} from '../conversationContinuedWork';
import type { ConversationBackgroundStage } from '../conversationBackgroundStatus';
import type { ConversationLifetimeEntry } from '../conversationLifetimeEntry';
import type { ConversationExecutionAdapter } from '../conversationExecutionLease';

function fixture() {
  let phase: 'active' | 'background' = 'active';
  const work = jest.fn();
  const report = jest.fn<void, [string, ConversationBackgroundStage]>();
  const owners = createContinuedRequestOwners();
  const controller = new AbortController();
  const entry = {
    id: 1,
    executionId: 'owned-execution',
    controller,
  } as ConversationLifetimeEntry;
  const execution: ConversationExecutionAdapter = {
    work,
    reportStatus: report,
    currentPhase: () => phase,
    begin: async () => true,
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  };
  owners.own(entry);
  adoptContinuedConversationLease(
    entry,
    Object.assign(jest.fn(), { admitted: true }),
    execution,
    false,
    () => owners.entries.get(1) === entry && !controller.signal.aborted,
  );
  const opportunity = continuedOpportunityObserver(
    entry,
    owners.entries,
    execution,
  );
  phase = 'background';
  opportunity('continued-deferred-inactive');
  const observer = owners.statusObserver(() => owners.owners.get(controller));
  return {
    controller,
    owners,
    entry,
    work,
    providerStages: () =>
      report.mock.calls
        .map(([, stage]) => stage)
        .filter(stage => stage.startsWith('provider_')),
    begin: () => observer.backgroundStatusForLease().onProviderExecution?.(),
    retry() {
      phase = 'active';
      opportunity('continuation-foreground');
    },
    grant() {
      phase = 'background';
      opportunity('continued-granted');
    },
    refuse: () => opportunity('continued-refused'),
    replace() {
      owners.own({ ...entry, controller: new AbortController() });
    },
  };
}

afterEach(() => jest.useRealTimers());

test('an owned in-flight provider gains bounded status only after its deferred native retry is granted', () => {
  jest.useFakeTimers();
  const f = fixture();
  const end = f.begin();
  expect(end).toEqual(expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
  f.retry();
  jest.advanceTimersByTime(30_000);
  expect(jest.getTimerCount()).toBe(0);
  expect(f.providerStages()).toEqual([]);
  f.grant();
  f.grant();
  expect(jest.getTimerCount()).toBe(1);
  expect(f.providerStages()).toEqual(['provider_waiting']);
  jest.advanceTimersByTime(15_000);
  expect(f.providerStages()).toEqual(['provider_waiting', 'provider_waiting']);
  end?.();
  expect(f.providerStages().at(-1)).toBe('provider_finished');
  expect(jest.getTimerCount()).toBe(0);
  expect(f.work.mock.calls).toEqual([
    ['owned-execution', true],
    ['owned-execution', true],
  ]);
});

test.each(['finished', 'refused', 'cancelled', 'replaced'] as const)(
  'a provider retired while awaiting a grant stays silent (%s)',
  state => {
    jest.useFakeTimers();
    const f = fixture();
    const end = f.begin();
    f.retry();
    if (state === 'finished') end?.();
    if (state === 'refused') f.refuse();
    if (state === 'cancelled') f.controller.abort();
    if (state === 'replaced') f.replace();
    f.grant();
    jest.advanceTimersByTime(30_000);
    expect(f.providerStages()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  },
);
