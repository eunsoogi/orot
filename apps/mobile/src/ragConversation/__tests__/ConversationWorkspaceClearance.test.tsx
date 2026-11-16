import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { resolveNavigationOcclusion } from '../../navigation/navigationLayout';
import { createNavigationGeometrySnapshot } from '../../navigation/navigationGeometry';
import { conversationHingeLayout } from '../conversationHingeLayout';
import { conversationWorkspaceOcclusion } from '../conversationWorkspaceOcclusion';
import { ConversationComposer } from '../ConversationComposer';

// Synthetic geometry proves reservation ownership; native layout is checked separately.
test.each([
  ['right', 800, 34, 4],
  ['bottom', 800, 94, 64],
  ['right', 500, 0, 4],
  ['bottom', 500, 52, 56],
] as const)(
  'consumes safe bottom once for %s navigation in a %s-point host',
  async (placement, height, clearance, expectedPadding) => {
    const geometry = createNavigationGeometrySnapshot({
      windowBounds: { x: 0, y: 0, width: 390, height: 800 },
      safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
      reservedRegionsSupported: true,
      reservedRegions: [],
    });
    expect(geometry).not.toBeNull();
    const plan = conversationHingeLayout(
      geometry,
      { x: 0, y: 0, width: 390, height },
      1,
    );
    const shell = resolveNavigationOcclusion({
      placement,
      reservedRightWidth: 0,
      systemBottomInset: 0,
      systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
      measuredBottomActionOcclusion: clearance,
    });
    const adjusted = conversationWorkspaceOcclusion(shell, height, plan);
    const composer = (compact: boolean) => (
      <NavigationOcclusionContext.Provider value={adjusted}>
        <ConversationComposer
          value="Synthetic draft"
          busy={false}
          compact={compact}
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onCancel={jest.fn()}
        />
      </NavigationOcclusionContext.Provider>
    );
    const view = await render(composer(false));
    const padding = () =>
      StyleSheet.flatten(
        screen.getByTestId('rag-conversation-composer').props.style,
      ).paddingBottom;
    expect(padding()).toBe(expectedPadding);
    expect(adjusted.systemInsets).toEqual(shell.systemInsets);
    expect(shell.scrollContentInsets.bottom).toBe(clearance);
    await view.rerender(composer(true));
    expect(padding()).toBe(expectedPadding - 4);
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
      'Synthetic draft',
    );
  },
);

test('does not deduct top occlusion or create negative clearance', () => {
  const shell = resolveNavigationOcclusion({
    placement: 'right',
    reservedRightWidth: 80,
    systemBottomInset: 0,
    systemInsets: { top: 20, right: 0, bottom: 34, left: 0 },
    measuredBottomActionOcclusion: 34,
  });
  expect(
    conversationWorkspaceOcclusion(shell, 800, { top: 20, height: 780 })
      .scrollContentInsets.bottom,
  ).toBe(34);
  expect(
    conversationWorkspaceOcclusion(shell, 800, { top: 20, height: 730 })
      .scrollContentInsets.bottom,
  ).toBe(0);
});
