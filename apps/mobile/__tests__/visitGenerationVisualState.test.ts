import { createVisitGenerationVisualRun } from '../e2e/visitGenerationVisualState';

function ready() {
  return jest.fn(async () => ({
    status: 'ready' as const,
    questions: [],
    caveats: [],
    validateSource: async () => true,
  }));
}

test('retains the existing ready fixture unless a state is explicitly selected', async () => {
  const complete = ready();
  const result = await createVisitGenerationVisualRun(
    undefined,
    complete,
  )({
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('ready');
  expect(complete).toHaveBeenCalledTimes(1);
});

test('keeps pending work alive until its owning route cancels it', async () => {
  const complete = ready();
  const controller = new AbortController();
  let settled = false;
  const pending = createVisitGenerationVisualRun(
    'pending',
    complete,
  )({
    signal: controller.signal,
  }).then(value => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(complete).not.toHaveBeenCalled();
  controller.abort();
  await expect(pending).resolves.toEqual({ status: 'cancelled' });
});

test.each(['unavailable', 'needs_clarification'])(
  'supplies the selected failure state without executing the ready operation (%s)',
  async setting => {
    const complete = ready();
    await expect(
      createVisitGenerationVisualRun(
        setting,
        complete,
      )({
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: setting, message: expect.any(String) });
    expect(complete).not.toHaveBeenCalled();
  },
);

test.each([undefined, 'pending', 'unavailable', 'needs_clarification'])(
  'does not start a pre-cancelled visual request (%s)',
  async setting => {
    const complete = ready();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createVisitGenerationVisualRun(
        setting,
        complete,
      )({
        signal: controller.signal,
      }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(complete).not.toHaveBeenCalled();
  },
);

test.each(['ready', 'yes', true, null])(
  'rejects an undeclared opt-in instead of hiding it as a normal result (%s)',
  setting => {
    expect(() => createVisitGenerationVisualRun(setting, ready())).toThrow(
      'Unsupported visit generation visual state',
    );
  },
);
