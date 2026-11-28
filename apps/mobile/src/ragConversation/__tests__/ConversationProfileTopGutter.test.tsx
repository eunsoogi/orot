import { render, screen } from '@testing-library/react-native';
import { Dimensions, View } from 'react-native';
import {
  NavigationContentFrameContext,
  resolveNavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometrySnapshot,
} from '../../navigation/navigationGeometry';
import { resolveNavigationRootLayout } from '../../navigation/navigationRootLayout';
import { ConversationWorkspace } from '../ConversationWorkspace';

let mockGeometry: NavigationGeometrySnapshot | null;
jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => mockGeometry,
}));
jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ ready: true, value: {}, edit: jest.fn() }),
}));
jest.mock('../../assistantAppearance/AppearanceEditor', () => ({
  AvatarSymbol: () => null,
}));
jest.mock('../../assistantAppearance/FloatingProfileGradient', () => ({
  FloatingProfileGradient: () => null,
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

// Mobile RN testing holds width stable through the genuine top/side input transition.
const windowBounds = { x: 0, y: 0, width: 750, height: 669 };
const originalWindow = Dimensions.get('window');
beforeEach(() => {
  Dimensions.set({
    window: { ...originalWindow, width: 750, height: 669, fontScale: 1 },
  });
});
afterEach(() => {
  Dimensions.set({ window: originalWindow });
});
const session = {
  id: 1,
  title: '합성 대화',
  createdAt: '2035-01-01T00:00:00Z',
  draft: '',
  busy: false,
  error: '',
  messages: [],
  pendingMessage: null,
};
const sourceActions = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
function mockScene(
  top: boolean,
  cornerX = 0,
  cornerMargin = 0,
  sceneWidth = 750,
  cornerWidth = 80,
) {
  const bounds = { ...windowBounds, width: sceneWidth };
  mockGeometry = createNavigationGeometrySnapshot({
    windowBounds: bounds,
    safeAreaInsets: { top: 56, left: 0, right: 0, bottom: 34 },
    hasHinge: true,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'synthetic-corner',
        kind: 'occlusion',
        isActive: true,
        frame: { x: cornerX, y: 0, width: cornerWidth, height: 80 },
        margins: { top: 0, right: cornerMargin, bottom: 0, left: 0 },
      },
    ],
    navigationSide: top ? 'bottom' : 'right',
    systemTopBarFrame: top ? { ...bounds, height: 56 } : undefined,
  });
  return (
    <NavigationContentFrameContext.Provider
      value={resolveNavigationContentFrame(
        mockGeometry,
        resolveNavigationRootLayout(mockGeometry),
      )}
    >
      <ConversationWorkspace session={session} sourceActions={sourceActions}>
        <View testID="synthetic-profile-transcript" />
      </ConversationWorkspace>
    </NavigationContentFrameContext.Provider>
  );
}

test('uses the focused top-indicator lane’s clear gutter without moving its hit target or transcript', async () => {
  const view = await render(mockScene(false));
  const artwork = screen.getByTestId('assistant-profile-artwork');
  const identity = screen.getByTestId('assistant-floating-identity');
  const transcript = screen.getByTestId('synthetic-profile-transcript');
  expect(artwork).not.toHaveStyle({ transform: [{ translateY: -12 }] });
  await view.rerender(mockScene(true));
  expect(artwork).toHaveStyle({ transform: [{ translateY: -12 }] });
  expect(screen.getByTestId('assistant-profile-label')).toHaveStyle({
    transform: [{ translateY: -12 }],
  });
  expect(identity).not.toHaveStyle({ transform: [{ translateY: -12 }] });
  expect(screen.getByTestId('synthetic-profile-transcript')).toBe(transcript);
  await view.rerender(mockScene(true, 350));
  expect(artwork).not.toHaveStyle({ transform: [{ translateY: -12 }] });
  await view.rerender(mockScene(false));
  expect(artwork).not.toHaveStyle({ transform: [{ translateY: -12 }] });
});

test('does not expand the already margin-inclusive UIKit occlusion into the profile', async () => {
  const view = await render(mockScene(false, 125, 40));
  const artwork = screen.getByTestId('assistant-profile-artwork');
  const target = screen.getByTestId('assistant-floating-identity');
  await view.rerender(mockScene(true, 125, 40));
  expect(artwork).toHaveStyle({ transform: [{ translateY: -12 }] });
  expect(target).not.toHaveStyle({ transform: [{ translateY: -12 }] });
  await view.rerender(mockScene(true, 165, 40));
  expect(artwork).not.toHaveStyle({ transform: [{ translateY: -12 }] });
});

test('lifts the profile in an expanded scene without changing navigation or hit-target ownership', async () => {
  Dimensions.set({
    window: { ...originalWindow, width: 951, height: 669, fontScale: 1 },
  });
  const view = await render(mockScene(false, 0, 6, 951, 8));
  const artwork = screen.getByTestId('assistant-profile-artwork');
  const target = screen.getByTestId('assistant-floating-identity');
  const transcript = screen.getByTestId('synthetic-profile-transcript');
  expect(artwork).not.toHaveStyle({ transform: [{ translateY: -12 }] });
  await view.rerender(mockScene(true, 0, 6, 951, 8));
  expect(artwork).toHaveStyle({ transform: [{ translateY: -12 }] });
  expect(screen.getByTestId('assistant-floating-identity')).toBe(target);
  expect(target).not.toHaveStyle({ transform: [{ translateY: -12 }] });
  expect(screen.getByTestId('synthetic-profile-transcript')).toBe(transcript);
});
