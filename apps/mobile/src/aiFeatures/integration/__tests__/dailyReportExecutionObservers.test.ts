import { dailyReportExecutionObservers } from '../dailyReportExecutionObservers';

function fixture() {
  const controller = new AbortController();
  return { controller, hub: dailyReportExecutionObservers(controller.signal) };
}

test('late owners receive only the latest observed state, never inferred work or task payloads', () => {
  const { hub } = fixture();
  const first = { onExecutionState: jest.fn(), onTaskStreamEvent: jest.fn() };
  hub.join(first);
  expect(first.onExecutionState).not.toHaveBeenCalled();
  hub.observe('working');
  const joined = { onExecutionState: jest.fn() };
  hub.join(joined);
  expect(joined.onExecutionState.mock.calls).toEqual([['working']]);
  hub.observe('decision');
  const awaiting = { onExecutionState: jest.fn() };
  hub.join(awaiting);
  expect(awaiting.onExecutionState.mock.calls).toEqual([['decision']]);
  hub.observe('local');
  const late = { onExecutionState: jest.fn() };
  hub.join(late);
  expect(late.onExecutionState.mock.calls).toEqual([['local']]);
  expect(first.onTaskStreamEvent).not.toHaveBeenCalled();
  hub.dispose();
});

test('subscriber abort, shared abort and settlement cannot notify departed owners', () => {
  const { controller, hub } = fixture();
  const owner = new AbortController();
  const first = { onExecutionState: jest.fn() };
  const second = { onExecutionState: jest.fn() };
  hub.join(first, owner.signal);
  hub.join(second);
  owner.abort();
  hub.observe('working');
  expect(first.onExecutionState).not.toHaveBeenCalled();
  expect(second.onExecutionState).toHaveBeenCalledTimes(1);
  controller.abort();
  hub.observe('decision');
  hub.join(first);
  expect(second.onExecutionState).toHaveBeenCalledTimes(1);
  expect(first.onExecutionState).not.toHaveBeenCalled();
  const next = fixture();
  next.hub.dispose();
  next.hub.join(first);
  next.hub.observe('working');
  expect(first.onExecutionState).not.toHaveBeenCalled();
});

test('nested state changes cannot deliver an obsolete outer state to another owner', () => {
  const { hub } = fixture();
  const first = {
    onExecutionState: jest.fn(state => {
      if (state === 'working') hub.observe('decision');
    }),
  };
  const second = { onExecutionState: jest.fn() };
  hub.join(first);
  hub.join(second);
  hub.observe('working');
  expect(second.onExecutionState.mock.calls).toEqual([['decision']]);
  hub.dispose();
});

test('synchronous join sees one observation and synchronous abort prevents later delivery', () => {
  const { controller, hub } = fixture();
  const joined = { onExecutionState: jest.fn() };
  const first = { onExecutionState: jest.fn(() => hub.join(joined)) };
  hub.join(first);
  hub.observe('working');
  expect(joined.onExecutionState.mock.calls).toEqual([['working']]);
  const aborting = { onExecutionState: () => controller.abort() };
  hub.join(aborting);
  hub.observe('local');
  expect(joined.onExecutionState.mock.calls).toEqual([['working']]);
});

test('observer errors and closed runtime tokens do not escape or authorize work', () => {
  const { hub } = fixture();
  hub.join({
    onExecutionState: () => {
      throw new Error('synthetic');
    },
  });
  const owner = { onExecutionState: jest.fn() };
  hub.join(owner);
  hub.observe('decision');
  hub.observe('untrusted' as 'working');
  expect(owner.onExecutionState.mock.calls).toEqual([['decision']]);
  hub.dispose();
});

// Returning to the same label must not revive an older broadcast epoch.
test('nested working-local-working observations do not duplicate the resumed state', () => {
  const { hub } = fixture();
  let nested = false;
  hub.join({
    onExecutionState: state => {
      if (state !== 'working' || nested) return;
      nested = true;
      hub.observe('local');
      hub.observe('working');
    },
  });
  const other = { onExecutionState: jest.fn() };
  hub.join(other);
  hub.observe('working');
  expect(other.onExecutionState.mock.calls).toEqual([['local'], ['working']]);
  hub.dispose();
});
