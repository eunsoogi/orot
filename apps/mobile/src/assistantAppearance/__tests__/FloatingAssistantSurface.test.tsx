import { useFloatingIdentityInset } from '../FloatingIdentityInset';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { FloatingAssistantSurface } from '../FloatingAssistantSurface';
import {
  NavigationContentFrameContext,
  resolveNavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import { createNavigationGeometrySnapshot } from '../../navigation/navigationGeometry';
import { resolveNavigationRootLayout } from '../../navigation/navigationRootLayout';
import type { ConversationSession } from '../../ragConversation/conversationSessionTypes';
let mockReady = true;
jest.mock('../AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ ready: mockReady }),
}));
jest.mock('../AssistantHeader', () => ({ AssistantHeader: () => null }));
jest.mock('../FloatingProfileGradient', () => ({
  FloatingProfileGradient: () => null,
}));
function Transcript() {
  const inset = useFloatingIdentityInset();
  return <View testID="transcript" style={{ paddingTop: inset }} />;
}
const session = { id: 1 } as ConversationSession;
test('measures only the floating group and leaves one independent transcript surface', async () => {
  await render(
    <FloatingAssistantSurface session={session}>
      <Transcript />
    </FloatingAssistantSurface>,
  );
  const overlay = screen.getByTestId('assistant-floating-overlay');
  expect(overlay).toHaveStyle({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  });
  expect(overlay.props.pointerEvents).toBe('box-none');
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 96 } },
  });
  expect(screen.getByTestId('transcript')).toHaveStyle({
    paddingTop: 96,
  });
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 64 } },
  });
  expect(screen.getByTestId('transcript')).toHaveStyle({
    paddingTop: 64,
  });
});
test('does not reserve a blank floating area before saved preferences are ready', async () => {
  mockReady = false;
  await render(
    <FloatingAssistantSurface session={session}>
      <Text>History</Text>
    </FloatingAssistantSurface>,
  );
  expect(screen.queryByTestId('assistant-floating-overlay')).toBeNull();
  expect(screen.getByText('History')).toBeTruthy();
  mockReady = true;
});

test('removes only decorative top padding for a safely reserved top indicator', async () => {
  function workshop(top: boolean) {
    const windowBounds = { x: 0, y: 0, width: 466, height: 678 };
    const geometry = createNavigationGeometrySnapshot({
      windowBounds,
      safeAreaInsets: { top: 52, right: 0, bottom: 34, left: 0 },
      reservedRegionsSupported: false,
      reservedRegions: [],
      systemTopBarFrame: top ? { ...windowBounds, height: 34 } : undefined,
    });
    const frame = resolveNavigationContentFrame(
      geometry,
      resolveNavigationRootLayout(geometry),
    );
    expect(frame?.availableContentFrame.y).toBe(52);
    return (
      <NavigationContentFrameContext.Provider value={frame}>
        <FloatingAssistantSurface session={session}>
          <Transcript />
        </FloatingAssistantSurface>
      </NavigationContentFrameContext.Provider>
    );
  }
  const surface = await render(workshop(false));
  expect(screen.getByTestId('assistant-floating-overlay')).toHaveStyle({
    paddingTop: 8,
    paddingBottom: 8,
  });
  await surface.rerender(workshop(true));
  const overlay = screen.getByTestId('assistant-floating-overlay');
  expect(overlay).toHaveStyle({ paddingTop: 0, paddingBottom: 8, top: 0 });
  expect(overlay.props.pointerEvents).toBe('box-none');
  await surface.rerender(workshop(false));
  expect(screen.getByTestId('assistant-floating-overlay')).toHaveStyle({
    paddingTop: 8,
    paddingBottom: 8,
  });
  expect(screen.getAllByTestId('transcript')).toHaveLength(1);
});
