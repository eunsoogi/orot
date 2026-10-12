import {
  registerTestApplicationRenderer,
  renderApplicationForTest,
} from '../e2e/testApplicationRenderer';

test('does not claim a rendered application when the host is absent', () => {
  expect(() => renderApplicationForTest()).toThrow('renderer is unavailable');
});

test('keeps one renderer registered and removes it when the host unmounts', () => {
  const callback = jest.fn();
  const remove = registerTestApplicationRenderer(callback);
  try {
    expect(renderApplicationForTest()).toEqual({ requested: true });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(() => registerTestApplicationRenderer(jest.fn())).toThrow(
      'already registered',
    );
  } finally {
    remove();
  }
  expect(() => renderApplicationForTest()).toThrow('renderer is unavailable');
});
