import {
  syntheticLiteratureService,
  syntheticPublication,
} from '../e2e/literatureVisualFixtures';

test('synthetic literature still requires explicit query consent', async () => {
  await expect(
    syntheticLiteratureService.search('sleep', {
      externalQueryConsented: false,
    }),
  ).resolves.toEqual({ status: 'consent_required' });
});

test('synthetic result, empty and failure states remain distinct', async () => {
  for (const [query, expected] of [
    ['sleep', { status: 'available', publications: [syntheticPublication] }],
    ['empty', { status: 'empty' }],
    ['failure', { status: 'unavailable' }],
  ] as const) {
    await expect(
      syntheticLiteratureService.search(query, {
        externalQueryConsented: true,
      }),
    ).resolves.toEqual(expected);
  }
});

test('pending literature reads settle only after their actual abort signal', async () => {
  const controller = new AbortController();
  let settled = false;
  const pending = syntheticLiteratureService
    .search('pending', {
      externalQueryConsented: true,
      signal: controller.signal,
    })
    .then(value => {
      settled = true;
      return value;
    });
  await Promise.resolve();
  expect(settled).toBe(false);
  controller.abort();
  await expect(pending).resolves.toEqual({ status: 'unavailable' });
});

test('an already cancelled synthetic search does not remain pending', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    syntheticLiteratureService.search('pending', {
      externalQueryConsented: true,
      signal: controller.signal,
    }),
  ).resolves.toEqual({ status: 'unavailable' });
});
