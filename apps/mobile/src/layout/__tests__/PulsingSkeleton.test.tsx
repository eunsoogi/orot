import { render } from '@testing-library/react-native';
import { Animated, View } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { PulsingSkeleton } from '../PulsingSkeleton';

test('stops decorative pulses when Reduce Motion changes and when loading ends', async () => {
  const start = jest.fn();
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({
    start,
    stop,
    reset: jest.fn(),
  });
  const fixture = (reduceMotion: boolean) => (
    <NavigationMotionContext.Provider value={reduceMotion}>
      <PulsingSkeleton testID="loading-placeholders">
        <View />
      </PulsingSkeleton>
    </NavigationMotionContext.Provider>
  );

  try {
    const rendered = await render(fixture(true));
    expect(loop).not.toHaveBeenCalled();
    const placeholder = rendered.getByTestId('loading-placeholders', {
      includeHiddenElements: true,
    });
    expect(placeholder.props.accessibilityElementsHidden).toBe(true);
    expect(placeholder.props.pointerEvents).toBe('none');

    await rendered.rerender(fixture(false));
    expect(start).toHaveBeenCalledTimes(1);
    await rendered.rerender(fixture(true));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);

    await rendered.rerender(fixture(false));
    expect(start).toHaveBeenCalledTimes(2);
    await rendered.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  } finally {
    loop.mockRestore();
  }
});
