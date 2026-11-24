import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Text, StyleSheet, Keyboard } from 'react-native';
import { render } from '@testing-library/react-native';
import SafeAreaLayout from '../SafeAreaLayout';
import { AppearanceEditor } from '../../assistantAppearance/AppearanceEditor';

jest.mock('../../navigation/NavigationModal', () => ({
  NavigationModal: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../assistantAppearance/appearanceStore', () => ({
  appearanceStore: { save: jest.fn() },
}));

let mockSafeRight = 0;

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  return {
    useSafeAreaInsets: () => ({
      top: 0,
      right: mockSafeRight,
      left: 0,
      bottom: 34,
    }),
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

  expect(getByTestId('safe-area-root').props.accessibilityHint).toBe(
    'top,right,bottom,left',
  );
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
    expect(view.getByTestId('safe-area-root').props.accessibilityHint).toBe(
      'top,left',
    );
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

test('only the configured Assistant Appearance editor owns the modal outer edge', async () => {
  mockSafeRight = 84;
  try {
    const onSave = jest.fn();
    const configured = await render(
      <AppearanceEditor
        initial={{ avatar: 'sun', name: null }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    const edgeScroll = configured.getByTestId('assistant-appearance-scroll');
    expect(edgeScroll.props.automaticallyAdjustsScrollIndicatorInsets).toBe(
      false,
    );
    expect(
      StyleSheet.flatten(edgeScroll.props.contentContainerStyle).paddingRight,
    ).toBe(84);
    await configured.unmount();

    const onboarding = await render(<AppearanceEditor onSave={onSave} />);
    expect(
      onboarding.getByTestId('assistant-appearance-scroll').props
        .scrollIndicatorInsets,
    ).toBeUndefined();
    expect(
      onboarding.getByTestId('safe-area-root').props.accessibilityHint,
    ).toBe('top,right,left');
    expect(onSave).not.toHaveBeenCalled();
  } finally {
    mockSafeRight = 0;
  }
});
