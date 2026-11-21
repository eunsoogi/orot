import {
  createReaderSceneAdapter,
  readerSceneOutcome,
} from '../classificationReaderSceneGeometry';
const session = '00000000-0000-0000-0000-000000000001';
const armed = {
  status: 'sampled',
  session,
  sceneID: '00000000-0000-0000-0000-000000000002',
  windowID: '00000000-0000-0000-0000-000000000003',
  generation: 1,
  candidateWindowCount: 1,
  requestCount: 0,
  before: { sceneOrientation: 1 },
  error: {},
  startedAtMs: 10,
  sampledAtMs: 20,
};
const settled = {
  ...armed,
  mode: 'read',
  requestCount: 1,
  windowBounds: { width: 678, height: 466 },
  current: { sceneOrientation: 3 },
  events: [
    {
      sceneID: armed.sceneID,
      windowID: armed.windowID,
      sceneOrientation: 3,
      width: 678,
      height: 466,
      atMs: 15,
      transition: 'completed',
      cancelled: false,
    },
  ],
};

test('accepts only the same native owner with a settled landscape delegate event', () => {
  expect(readerSceneOutcome(armed, settled)).toBe('settled');
  expect(readerSceneOutcome(armed, { ...settled, error: { code: 101 } })).toBe(
    'denied',
  );
  expect(readerSceneOutcome(armed, { ...settled, events: [] })).toBe(
    'unsettled',
  );
  expect(
    readerSceneOutcome(armed, {
      ...settled,
      events: [{ ...settled.events[0], transition: 'pending' }],
    }),
  ).toBe('unsettled');
  for (const key of ['session', 'sceneID', 'windowID', 'generation'])
    expect(readerSceneOutcome(armed, { ...settled, [key]: 'foreign' })).toBe(
      'owner-mismatch',
    );
});
test('a measured portrait or cancelled event is never a wide pass', () => {
  expect(
    readerSceneOutcome(armed, {
      ...settled,
      windowBounds: { width: 466, height: 678 },
    }),
  ).toBe('unsettled');
  expect(
    readerSceneOutcome(armed, {
      ...settled,
      events: [{ ...settled.events[0], cancelled: true }],
    }),
  ).toBe('unsettled');
});
test('sends start/request/read once and rejects further commands', async () => {
  const command = jest.fn(async (_session, mode) =>
    mode === 'read' ? settled : { ...armed, mode },
  );
  const adapter = createReaderSceneAdapter(session, command);
  expect((await adapter.run())?.outcome).toBe('armed');
  expect((await adapter.run())?.outcome).toBe('requested');
  expect((await adapter.run())?.outcome).toBe('settled');
  expect(await adapter.run()).toBeNull();
  expect(command.mock.calls.map(call => call[1])).toEqual([
    'start',
    'request',
    'read',
  ]);
});
test('denial and owner changes terminate rather than retry', async () => {
  for (const second of [
    { ...armed, error: { code: 101 } },
    { ...armed, windowID: session },
  ]) {
    const command = jest.fn(async (_session, mode) => ({
      ...(mode === 'start' ? armed : second),
      mode,
    }));
    const adapter = createReaderSceneAdapter(session, command);
    await adapter.run();
    expect(['denied', 'owner-mismatch']).toContain(
      (await adapter.run())?.outcome,
    );
    expect(await adapter.run()).toBeNull();
    expect(command).toHaveBeenCalledTimes(2);
  }
});
test('invalid session, concurrent tap, and disposed continuation cannot issue extra commands', async () => {
  let resolve!: (value: unknown) => void;
  const command = jest.fn(
    () =>
      new Promise(resolveValue => {
        resolve = resolveValue;
      }),
  );
  expect(await createReaderSceneAdapter('invalid', command).run()).toBeNull();
  const adapter = createReaderSceneAdapter(session, command);
  const pending = adapter.run();
  expect(await adapter.run()).toBeNull();
  adapter.dispose();
  resolve({ ...armed, mode: 'start' });
  expect(await pending).toBeNull();
  expect(await adapter.run()).toBeNull();
  expect(command).toHaveBeenCalledTimes(1);
});

test('missing errors, invalid timestamps and foreign events never establish success', async () => {
  for (const error of [undefined, null, [], '']) {
    expect(readerSceneOutcome(armed, { ...settled, error })).toBe('denied');
  }
  for (const key of ['startedAtMs', 'sampledAtMs']) {
    for (const value of [undefined, NaN, Infinity]) {
      const command = jest.fn(async () => ({
        ...armed,
        mode: 'start',
        [key]: value,
      }));
      const adapter = createReaderSceneAdapter(session, command);
      expect((await adapter.run())?.outcome).toBe('denied');
      expect(await adapter.run()).toBeNull();
      expect(command).toHaveBeenCalledTimes(1);
      expect(readerSceneOutcome(armed, { ...settled, [key]: value })).toBe(
        'unsettled',
      );
    }
  }
  for (const key of ['windowID', 'sceneID'])
    expect(
      readerSceneOutcome(armed, {
        ...settled,
        events: [{ ...settled.events[0], [key]: 'foreign' }],
      }),
    ).toBe('unsettled');
});
