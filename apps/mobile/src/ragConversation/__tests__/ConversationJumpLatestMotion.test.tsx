import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationJumpToLatest } from '../ConversationJumpToLatest';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { trackJumpLatestMotion } from '../testSupport/jumpLatestMotion';

jest.mock('../../layout/GlassIconButton', () => ({
  GlassIconButton: require('react-native').Pressable,
}));
afterEach(() => jest.restoreAllMocks());

const actionID = 'conversation-jump-latest';
const visualID = 'conversation-jump-latest-fade';
const hostID = 'conversation-jump-latest-position';
const quiet = { includeHiddenElements: true };

function scene(visible: boolean, onPress: () => void, reduced = false) {
  return (
    <NavigationMotionContext.Provider value={reduced}>
      <ConversationJumpToLatest
        visible={visible}
        onPress={onPress}
        bottom={96}
      />
    </NavigationMotionContext.Provider>
  );
}

test('fades a decorative surface at the same position and retires the real hit target immediately', async () => {
  const phases = trackJumpLatestMotion();
  const press = jest.fn();
  const view = await render(scene(false, press));
  expect(screen.queryByTestId(hostID, quiet)).toBeNull();
  await view.rerender(scene(true, press));
  expect(phases.map(phase => phase.target)).toEqual([1]);
  expect(screen.queryByTestId(actionID, quiet)).toBeNull();
  expect(screen.getByTestId(hostID, quiet)).toHaveStyle({ bottom: 104 });
  expect(screen.getByTestId(visualID, quiet)).toHaveProp(
    'pointerEvents',
    'none',
  );
  expect(screen.queryByTestId(visualID)).toBeNull();
  await act(() => phases[0]!.finish());
  expect(screen.queryByTestId(visualID, quiet)).toBeNull();
  expect(screen.getByTestId(hostID)).toHaveStyle({ bottom: 104 });
  const live = screen.getByTestId(actionID);
  expect(live).toHaveStyle({ width: 44, height: 44 });
  const queued = live.props.onClick ?? live.props.onPress;
  expect(typeof queued).toBe('function');
  await fireEvent.press(live);
  expect(press).toHaveBeenCalledTimes(1);
  await view.rerender(scene(false, press));
  expect(screen.queryByTestId(actionID, quiet)).toBeNull();
  expect(screen.getByTestId(hostID, quiet)).toHaveProp('pointerEvents', 'none');
  expect(screen.getByTestId(visualID, quiet)).toBeTruthy();
  expect(phases.map(phase => phase.target)).toEqual([1, 0]);

  await view.rerender(scene(true, press));
  expect(phases[1]!.stop).toHaveBeenCalled();
  await act(() => phases[1]!.finish()); // Stale native completion must not erase the new visual.
  expect(screen.getByTestId(visualID, quiet)).toBeTruthy();
  await act(() => phases[2]!.finish());
  expect(screen.getByTestId(actionID)).toBeTruthy();
  await act(() => queued?.());
  expect(press).toHaveBeenCalledTimes(1);
  await view.rerender(scene(false, press));
  await act(() => phases[3]!.finish());
  expect(screen.queryByTestId(hostID, quiet)).toBeNull();
});

test('Reduce Motion has no decorative frames and interrupts an active fade', async () => {
  const phases = trackJumpLatestMotion();
  const press = jest.fn();
  const view = await render(scene(true, press, true));
  expect(screen.getByTestId(actionID)).toBeTruthy();
  expect(phases).toHaveLength(0);
  await view.rerender(scene(false, press, true));
  expect(screen.queryByTestId(hostID, quiet)).toBeNull();
  await view.rerender(scene(true, press));
  expect(screen.getByTestId(visualID, quiet)).toBeTruthy();
  await view.rerender(scene(true, press, true));
  expect(phases[0]!.stop).toHaveBeenCalled();
  expect(screen.queryByTestId(visualID, quiet)).toBeNull();
  expect(screen.getByTestId(actionID)).toBeTruthy();
  await act(() => phases[0]!.finish());
  expect(screen.getByTestId(actionID)).toBeTruthy();
});
