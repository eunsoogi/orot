import { act, renderHook } from '@testing-library/react-native';
import type { HostInstance } from 'react-native';
import { useConversationWorkspaceBounds } from '../useConversationWorkspaceBounds';

jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => null,
}));

/** Native measurement responses may arrive after a newer keyboard/host layout. */
test('an older measurement cannot overwrite the latest completed host bounds', async () => {
  const callbacks: ((
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void)[] = [];
  const { result } = await renderHook(() => useConversationWorkspaceBounds());
  result.current.ref.current = {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => callbacks.push(callback),
  } as unknown as HostInstance;
  await act(() => {
    result.current.measure();
    result.current.measure();
  });
  await act(() => callbacks[1]!(0, 0, 390, 300));
  expect(result.current.plan.height).toBe(300);
  await act(() => callbacks[0]!(0, 0, 390, 600));
  expect(result.current.plan.height).toBe(300);
});
