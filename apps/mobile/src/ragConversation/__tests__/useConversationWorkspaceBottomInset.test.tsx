import { act, renderHook } from '@testing-library/react-native';
import type { HostInstance } from 'react-native';
import { NavigationContentFrameContext } from '../../navigation/navigationContentFrame';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { createNavigationGeometrySnapshot } from '../../navigation/navigationGeometry';
import { useConversationWorkspaceBounds } from '../useConversationWorkspaceBounds';

const mockGeometry = createNavigationGeometrySnapshot({
  windowBounds: { x: 0, y: 0, width: 390, height: 800 },
  safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
  reservedRegionsSupported: true,
  reservedRegions: [],
});

test('clips stale native host measurements to the keyboard-contracted shell and restores them on expansion', async () => {
  const frame = { x: 0, y: 0, width: 390, height: 800 };
  const shared = {
    windowFrame: frame,
    viewportFrame: frame,
    availableContentFrame: frame,
    reservedRegions: [],
    side: 'right' as const,
    navigationFrame: null,
  };
  let height = 800;
  const { result, rerender } = await renderHook(
    () => useConversationWorkspaceBounds('conversation'),
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <NavigationContentFrameContext.Provider
          value={{ ...shared, availableContentFrame: { ...frame, height } }}
        >
          {children}
        </NavigationContentFrameContext.Provider>
      ),
    },
  );
  result.current.ref.current = {
    measureInWindow: callback => callback(0, 0, 390, 800),
  } as HostInstance;
  await act(() => result.current.measure());
  height = 500;
  await rerender(undefined);
  expect(result.current.plan.height).toBe(500);
  height = 800;
  await rerender(undefined);
  expect(result.current.plan.height).toBe(800);
});
jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => mockGeometry,
}));

// Replay shell measurements; this proves context wiring, not UIKit rendering.
test('the routed workspace fills its host while the composer retains home clearance', async () => {
  const frame = { x: 0, y: 0, width: 390, height: 800 };
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const { result } = await renderHook(
    () => useConversationWorkspaceBounds('conversation'),
    {
      wrapper: ({ children }) => (
        <NavigationContentFrameContext.Provider
          value={{
            windowFrame: frame,
            viewportFrame: frame,
            availableContentFrame: frame,
            reservedRegions: [],
            side: 'right',
            navigationFrame: null,
          }}
        >
          <NavigationOcclusionContext.Provider
            value={{
              placement: 'right',
              systemInsets: { ...zero, bottom: 34 },
              viewportInsets: zero,
              scrollContentInsets: { ...zero, bottom: 34 },
            }}
          >
            {children}
          </NavigationOcclusionContext.Provider>
        </NavigationContentFrameContext.Provider>
      ),
    },
  );
  expect(result.current.plan.height).toBe(800);
  expect(result.current.workspaceOcclusion.scrollContentInsets.bottom).toBe(24);
  result.current.ref.current = {
    measureInWindow: callback => callback(0, 0, 390, 500),
  } as HostInstance;
  await act(() => result.current.measure());
  expect(result.current.plan.height).toBe(500);
  // Keyboard clearance belongs to the changing shell; this hook never invents a second deduction.
  expect(result.current.workspaceOcclusion.scrollContentInsets.bottom).toBe(34);
});
