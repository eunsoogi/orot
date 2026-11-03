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
        const {
          actions = [],
          children,
          onAction,
          pageMetricsRequest,
          onPageMetrics,
          ...viewProps
        } = props;
        const { width, fontScale } =
          require('react-native').useWindowDimensions();
        const lastMetrics = React.useRef('');
        // Synthetic inputs exercise the bridge contract; UIKit measurements remain native evidence.
        React.useLayoutEffect(() => {
          if (
            !pageMetricsRequest ||
            !onPageMetrics ||
            global.__OROT_TEST_PAGE_METRICS__ === null
          )
            return;
          const key = `${pageMetricsRequest.revision}:${width}:${fontScale}`;
          if (lastMetrics.current === key) return;
          lastMetrics.current = key;
          const widths = pageMetricsRequest.actions.map(
            action =>
              action.layoutWidth ??
              (action.rootTab
                ? Math.max(44, action.label.length * 6 * fontScale + 8)
                : action.id === 'back'
                  ? 48
                  : action.id === 'home'
                    ? 64
                    : action.id === 'page:overflow'
                      ? 48
                      : Math.max(88, action.label.length * 7 * fontScale + 24)),
          );
          onPageMetrics({
            nativeEvent: {
              revision: pageMetricsRequest.revision,
              width,
              widths,
              heights: pageMetricsRequest.actions.map(action =>
                action.rootTab ? 60 : 48,
              ),
            },
          });
        }, [pageMetricsRequest, width, fontScale, onPageMetrics]);
        // Production passes action data to UIKit; this adapter models only its JS contract.
        if (children !== undefined) {
          throw new Error(
            'NavigationGlassView must not receive React children.',
          );
        }

        return React.createElement(
          name,
          {
            ...viewProps,
            actions,
            onAction,
            pageMetricsRequest,
            onPageMetrics,
          },
          ...actions.map(action =>
            React.createElement(
              'View',
              {
                accessible: true,
                accessibilityLabel: action.accessibilityLabel,
                accessibilityRole: 'button',
                accessibilityState: {
                  disabled: action.disabled === true,
                  ...(action.selected === true ? { selected: true } : {}),
                },
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
