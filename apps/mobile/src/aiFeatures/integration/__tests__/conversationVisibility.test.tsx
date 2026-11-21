import { AppState } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { useConversationVisibility } from '../useConversationVisibility';

test('a retained predicate reads the latest route and overlay visibility', async () => {
  let current = true;
  const isCurrent = () => current;
  const view = await renderHook(
    ({ source, provider }: { source: boolean; provider: boolean }) =>
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

test('same route still owns presentation in background without action authority', async () => {
  const prior = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
  const phase = (state: 'active' | 'background') =>
    Object.defineProperty(AppState, 'currentState', {
      value: state,
      configurable: true,
    });
  let owned = true;
  try {
    phase('active');
    const owner = () => owned;
    const view = await renderHook(
      ({ overlay }: { overlay: boolean }) => ({
        canAct: useConversationVisibility(owner, overlay, false, true),
        canPaint: useConversationVisibility(owner, overlay, false),
      }),
      { initialProps: { overlay: false } },
    );
    const { canAct, canPaint } = view.result.current;
    expect(canAct()).toBe(true);
    phase('background');
    expect(canPaint()).toBe(true);
    expect(canAct()).toBe(false);
    owned = false;
    expect(canPaint()).toBe(false);
    owned = true;
    phase('active');
    await view.rerender({ overlay: true });
    expect(canPaint()).toBe(false);
    expect(canAct()).toBe(false);
  } finally {
    Object.defineProperty(AppState, 'currentState', prior);
  }
});
