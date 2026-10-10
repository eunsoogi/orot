/* global jest */

jest.mock('react-native/Libraries/ReactNative/requireNativeComponent', () => {
  const React = require('react');
  const mockNativeComponent = jest.requireActual(
    '@react-native/jest-preset/jest/mockNativeComponent',
  ).default;

  return {
    __esModule: true,
    default: name => {
      if (name !== 'NavigationGlassView') {
        return mockNativeComponent(name);
      }

      return function NavigationGlassViewTestAdapter(props) {
        const { actions = [], children, onAction, ...viewProps } = props;
        // Production passes action data to UIKit; this adapter models only its JS contract.
        if (children !== undefined) {
          throw new Error(
            'NavigationGlassView must not receive React children.',
          );
        }

        return React.createElement(
          name,
          { ...viewProps, actions, onAction },
          ...actions.map(action =>
            React.createElement(
              'View',
              {
                accessible: true,
                accessibilityLabel: action.accessibilityLabel,
                accessibilityRole: 'button',
                accessibilityState: { disabled: action.disabled === true },
                disabled: action.disabled === true,
                key: action.id,
                onPress: () => onAction?.({ nativeEvent: { id: action.id } }),
                testID: action.testID,
              },
              React.createElement('Text', null, action.label),
            ),
          ),
        );
      };
    },
  };
});
