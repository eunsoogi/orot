import {
  createStatementMemoryScheduler,
  withStatementMemory,
} from '../scheduleStatementMemory';
import type { SqlDatabase } from '@orot/storage';
function fixture() {
  let active = true;
  const runtime = {
    open: jest.fn(async () => ({ remember: jest.fn() })),
    enqueue: jest.fn(async () => {}),
    process: jest.fn(async () => {}),
  };
  const load = jest.fn(async () => runtime);
  const schedule = createStatementMemoryScheduler(load, () => active);
  return {
    runtime,
    load,
    schedule,
    background: () => {
      active = false;
    },
    database: {} as SqlDatabase,
  };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('answer append resolves before deferred memory work and no save result is replaced', async () => {
  const f = fixture();
  const append = jest.fn().mockResolvedValue(undefined);
  const store = withStatementMemory({ append }, f.database, f.schedule);
  await store.append({} as never);
  expect(append).toHaveBeenCalledTimes(1);
  expect(f.load).not.toHaveBeenCalled();
  jest.runOnlyPendingTimers();
  await f.schedule(f.database);
  expect(f.runtime.process).toHaveBeenCalledTimes(1);
});
test('failed append and inactive app do not admit memory work', async () => {
  const f = fixture();
  const store = withStatementMemory(
    {
      append: jest.fn().mockRejectedValue(new Error('Synthetic save failure')),
    },
    f.database,
    f.schedule,
  );
  await expect(store.append({} as never)).rejects.toThrow(
    'Synthetic save failure',
  );
  f.background();
  await f.schedule(f.database);
  expect(f.load).not.toHaveBeenCalled();
});
test('background transition during open skips migration and processing', async () => {
  const f = fixture();
  f.runtime.open.mockImplementation(async () => {
    f.background();
    return { remember: jest.fn() };
  });
  await f.schedule(f.database);
  expect(f.runtime.enqueue).not.toHaveBeenCalled();
  expect(f.runtime.process).not.toHaveBeenCalled();
});
