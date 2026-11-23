import { act } from '@testing-library/react-native';
import { AppState, Dimensions, View } from 'react-native';

/** Model native window-coordinate callbacks without using a personal chart. */
export function installChartBarTooltipTestMeasurements() {
  type NativeMeasurement = (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  const measurableView = View as unknown as {
    prototype: { measureInWindow: (callback: NativeMeasurement) => void };
  };
  const dimensions = {
    window: Dimensions.get('window'),
    screen: Dimensions.get('screen'),
  };
  let plotY = 100;
  const originalState = AppState.currentState;
  beforeEach(async () => {
    AppState.currentState = 'active';
    plotY = 100;
    const frame = { width: 390, height: 680, scale: 3, fontScale: 1 };
    await act(async () => Dimensions.set({ window: frame, screen: frame }));
    jest
      .spyOn(measurableView.prototype, 'measureInWindow')
      .mockImplementation(function (
        this: { props: { testID?: string } },
        callback,
      ) {
        if (this.props.testID === 'chart-host') callback(0, 0, 390, 1000);
        if (this.props.testID === 'chart-plot-anchor')
          callback(20, plotY, 160, 300);
      });
  });
  afterEach(async () => {
    AppState.currentState = originalState;
    jest.restoreAllMocks();
    await act(async () => Dimensions.set(dimensions));
  });
  return {
    setPlotY: (value: number) => {
      plotY = value;
    },
  };
}
