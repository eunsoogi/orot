import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { resolveNavigationOcclusion } from '../../navigation/navigationLayout';
import { ConversationComposer } from '../ConversationComposer';

// Synthetic shell reservations prove only spacing ownership, not native geometry.
test.each([
  ['right', 34, null, 4],
  ['bottom', 34, 86, 90],
  ['bottom', 34, null, 90],
  ['right', 0, 0, 4],
] as const)(
  'keeps %s navigation reservations with bottom inset %s and measured overlap %s',
  async (placement, bottom, measuredBottomActionOcclusion, expected) => {
    const occlusion = resolveNavigationOcclusion({
      placement,
      reservedRightWidth: placement === 'right' ? 80 : 0,
      systemBottomInset: bottom,
      systemInsets: { top: 0, right: 0, bottom, left: 0 },
      measuredBottomActionOcclusion,
    });
    const composer = (compact: boolean) => (
      <NavigationOcclusionContext.Provider value={occlusion}>
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
    expect(padding()).toBe(expected);
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
      'Synthetic draft',
    );
    await view.rerender(composer(true));
    expect(padding()).toBe(expected - 4);
    await view.rerender(composer(false));
    expect(padding()).toBe(expected);
  },
);
