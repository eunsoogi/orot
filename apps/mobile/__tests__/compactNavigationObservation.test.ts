import { compactNavigationObservation } from '../e2e/compactNavigationObservation';

test('retains gesture state and native point units without screen or lifecycle text', () => {
  const value = JSON.parse(
    compactNavigationObservation({
      atMs: 12345,
      navigation: [{ depth: 3 }],
      events: [
        {
          state: 3,
          controllerDepth: 3,
          translationX: 221.35,
          translationY: 0,
          velocityX: 800.01,
          publicPopControllers: [{ roles: ['edge-pop', 'private text'] }],
          screenText: 'private screen text',
        },
      ],
      lifecycle: [{ message: 'private lifecycle text' }],
    }),
  );
  expect(value).toEqual({
    atMs: 12345,
    navigationCount: 1,
    depths: [3],
    eventCount: 1,
    latest: {
      state: 3,
      depth: 3,
      dx: 221.4,
      dy: 0,
      vx: 800,
      roles: ['edge-pop'],
    },
  });
  expect(JSON.stringify(value)).not.toMatch(/private/);
});

test('keeps quiet events and incomplete observations distinct from a completed gesture', () => {
  expect(JSON.parse(compactNavigationObservation(null))).toEqual({
    navigationCount: 0,
    depths: [],
    eventCount: 0,
    latest: null,
  });
  expect(
    JSON.parse(compactNavigationObservation({ events: [{ state: NaN }] }))
      .latest,
  ).toEqual({ roles: [] });
  expect(
    JSON.parse(
      compactNavigationObservation({ events: [{ state: Number.MAX_VALUE }] }),
    ).latest,
  ).toEqual({ roles: [] });
});

test('bounds displayed navigation without silently losing its total count', () => {
  const encoded = compactNavigationObservation({
    navigation: Array.from({ length: 100 }, (_, depth) => ({ depth })),
    events: Array.from({ length: 32 }, () => ({ state: 2, translationX: 20 })),
  });
  expect(encoded.length).toBeLessThan(512);
  expect(JSON.parse(encoded)).toMatchObject({
    navigationCount: 100,
    depths: [0, 1, 2, 3],
    eventCount: 32,
    latest: { state: 2, dx: 20 },
  });
});
