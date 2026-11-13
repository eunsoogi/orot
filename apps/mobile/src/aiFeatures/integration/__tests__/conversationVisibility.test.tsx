import { renderHook } from '@testing-library/react-native';
import { useConversationVisibility } from '../useConversationVisibility';

test('a retained predicate reads the latest route and overlay visibility', async () => {
  let current = true;
  const isCurrent = () => current;
  const view = await renderHook(
    ({ source, provider }) =>
      useConversationVisibility(isCurrent, source, provider),
    { initialProps: { source: false, provider: false } },
  );
  const predicate = view.result.current;
  expect(predicate()).toBe(true);
  current = false;
  expect(predicate()).toBe(false);
  current = true;
  await view.rerender({ source: true, provider: false });
  expect(predicate()).toBe(false);
  await view.rerender({ source: false, provider: true });
  expect(predicate()).toBe(false);
  await view.rerender({ source: false, provider: false });
  expect(predicate()).toBe(true);
});
