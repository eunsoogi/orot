import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Text, StyleSheet, Keyboard } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import SafeAreaLayout from '../SafeAreaLayout';
import { appColors } from '../appColors';
import { AppearanceEditor } from '../../assistantAppearance/AppearanceEditor';

jest.mock('../../navigation/NavigationModal', () => ({
  NavigationModal: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../assistantAppearance/appearanceStore', () => ({
  appearanceStore: { save: jest.fn() },
}));

let mockSafeRight = 0;
let mockSafeLeft = 0;
let mockSafeFrame = { x: 0, y: 0, width: 390, height: 844 };

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  return {
    useSafeAreaInsets: () => ({
      top: 0,
      right: mockSafeRight,
      left: mockSafeLeft,
      bottom: 34,
    }),
    useSafeAreaFrame: () => mockSafeFrame,
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({
      children,
      edges,
      style,
      testID,
    }: {
      children?: ReactNode;
      edges?: readonly string[];
      style?: StyleProp<ViewStyle>;
      testID?: string;
    }) =>
      React.createElement(
        View,
        { accessibilityHint: edges?.join(','), style, testID },
        children,
      ),
  };
});

// Native Simulator assertions cover geometry; these tests guard the layout contract.
test('applies every screen edge to the route root', async () => {
  const { getByTestId } = await render(
    <SafeAreaLayout>
      <Text>Route content</Text>
    </SafeAreaLayout>,
  );

  const root = getByTestId('safe-area-root');
  expect(root.props.accessibilityHint).toBe('top,right,bottom,left');
  expect(root).toHaveStyle({ backgroundColor: appColors.background });
});

test('configures keyboard-aware scrolling for overflowing route content', async () => {
  const { getByTestId } = await render(
    <SafeAreaLayout scrollable>
      <Text testID="route-content">Route content</Text>
    </SafeAreaLayout>,
  );

  const scroll = getByTestId('safe-area-scroll');
  expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(getByTestId('safe-area-root').props.accessibilityHint).toBe(
    'top,right,left',
  );
  expect(scroll.props.contentInsetAdjustmentBehavior).toBe('never');
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    flexGrow: 1,
    paddingBottom: 50,
  });
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(getByTestId('route-content')).toBeVisible();
});

test.each([true, false])(
  'preserves end clearance independently of keyboard visibility (%s)',
  async visible => {
    const spy = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(visible);
    const { getByTestId } = await render(
      <SafeAreaLayout scrollable scrollContentStyle={{ padding: 24 }}>
        <Text>Editable content</Text>
      </SafeAreaLayout>,
    );
    expect(
      StyleSheet.flatten(
        getByTestId('safe-area-scroll').props.contentContainerStyle,
      ).paddingBottom,
    ).toBe(58);
    spy.mockRestore();
  },
);

test('lets an explicitly standalone scroll viewport own the physical right edge and keeps its editor inset', async () => {
  mockSafeRight = 84;
  const page = () => (
    <SafeAreaLayout
      scrollable
      outerScrollIndicator
      scrollContentStyle={{
        maxWidth: 520,
        width: '100%',
        alignSelf: 'center',
        padding: 24,
      }}
    >
      <Text testID="editable">Editable content</Text>
    </SafeAreaLayout>
  );
  try {
    const view = await render(page());
    const scroll = view.getByTestId('safe-area-scroll');
    const editable = view.getByTestId('editable');
    const root = view.getByTestId('safe-area-root');
    expect(root.props.accessibilityHint).toBe('top,left');
    expect(root).toHaveStyle({ backgroundColor: appColors.background });
    expect(scroll.props.automaticallyAdjustsScrollIndicatorInsets).toBe(false);
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scroll.props.scrollIndicatorInsets).toEqual({
      top: 0,
      right: 0,
      bottom: 34,
      left: 0,
    });
    expect(
      StyleSheet.flatten(scroll.props.contentContainerStyle),
    ).toMatchObject({ flexGrow: 1, paddingRight: 84 });
    expect(
      StyleSheet.flatten(
        view.getByTestId('safe-area-scroll-readable-content').props.style,
      ),
    ).toMatchObject({
      maxWidth: 520,
      width: '100%',
      alignSelf: 'center',
      padding: 24,
      paddingBottom: 58,
    });
    expect(editable).toBeVisible();
    mockSafeRight = 0;
    await view.rerender(page());
    expect(view.getByTestId('safe-area-scroll')).toBe(scroll);
    expect(view.getByTestId('editable')).toBe(editable);
    expect(
      StyleSheet.flatten(scroll.props.contentContainerStyle).paddingRight,
    ).toBe(0);
  } finally {
    mockSafeRight = 0;
  }
});

test.each([
  [390, 844, 12, 84, 0, 0],
  [704, 832, 24, 120, 0, 0],
  [844, 390, 47, 47, 47, 47],
])(
  'configured Assistant editor expands the scroll lane at %ix%i',
  async (width, height, left, right, contentLeft, contentRight) => {
    mockSafeFrame = { x: 0, y: 0, width, height };
    mockSafeLeft = left;
    mockSafeRight = right;
    try {
      const onCancel = jest.fn();
      const view = await render(
        <AppearanceEditor
          initial={{ avatar: 'sun', name: null }}
          onSave={jest.fn()}
          onCancel={onCancel}
        />,
      );
      const scroll = view.getByTestId('assistant-appearance-scroll');
      expect(view.getByTestId('safe-area-root').props.accessibilityHint).toBe(
        'top',
      );
      expect(scroll.props.automaticallyAdjustsScrollIndicatorInsets).toBe(
        false,
      );
      expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
      expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
      expect(
        StyleSheet.flatten(scroll.props.contentContainerStyle),
      ).toMatchObject({ paddingStart: contentLeft, paddingEnd: contentRight });
      const form = StyleSheet.flatten(
        view.getByTestId('safe-area-scroll-readable-content').props.style,
      );
      expect(form.maxWidth).toBeUndefined();
      expect(form).toMatchObject({ padding: 24, paddingBottom: 58 });
      const avatar = view.getByTestId('assistant-appearance-avatar-leaf');
      await fireEvent.press(avatar);
      expect(avatar.props.accessibilityState.checked).toBe(true);
      const name = view.getByPlaceholderText('어떤 이름으로 부를까요?');
      await fireEvent.changeText(name, '테스트');
      expect(name.props.value).toBe('테스트');
      expect(view.getByTestId('assistant-appearance-save')).toBeVisible();
      await fireEvent.press(view.getByRole('button', { name: '취소' }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      mockSafeRight = 0;
      mockSafeLeft = 0;
      mockSafeFrame = { x: 0, y: 0, width: 390, height: 844 };
    }
  },
);

test('onboarding keeps its contained controls', async () => {
  mockSafeRight = 84;
  try {
    const view = await render(<AppearanceEditor onSave={jest.fn()} />);
    const scroll = view.getByTestId('assistant-appearance-scroll');
    expect(scroll.props.scrollIndicatorInsets).toBeUndefined();
    expect(view.getByTestId('safe-area-root').props.accessibilityHint).toBe(
      'top,right,left',
    );
    expect(
      StyleSheet.flatten(scroll.props.contentContainerStyle).maxWidth,
    ).toBe(520);
  } finally {
    mockSafeRight = 0;
  }
});
