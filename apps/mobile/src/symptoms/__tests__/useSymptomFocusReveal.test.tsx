import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
  TextInputInstance,
} from 'react-native';
import useSymptomFocusReveal from '../useSymptomFocusReveal';

function fixture() {
  let fieldY = 425;
  let focused = true;
  const input = {
    measureInWindow: jest.fn(callback => callback(35, fieldY, 160, 37)),
    isFocused: jest.fn(() => focused),
    focus: jest.fn(),
    blur: jest.fn(),
    clear: jest.fn(),
  };
  const scrollTo = jest.fn();
  const host = {
    measureInWindow: jest.fn(callback => callback(0, 62, 402, 444)),
  };
  const scroll = {
    current: {
      getNativeScrollRef: () => host,
      scrollTo,
    } as unknown as ScrollViewInstance,
  };
  return {
    input,
    scroll,
    scrollTo,
    host,
    field: input as unknown as TextInputInstance,
    move: (y: number) => {
      fieldY = y;
    },
    unfocus: () => {
      focused = false;
    },
  };
}

function scrollEvent(y: number) {
  return {
    nativeEvent: { contentOffset: { x: 0, y } },
  } as NativeSyntheticEvent<NativeScrollEvent>;
}

describe('focused symptom field visibility', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scrolls only the measured overlap above the measured navigation obstruction, preserving focus and text', async () => {
    const f = fixture();
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(f.scroll, 52),
    );
    await act(() => {
      result.current.onScroll(scrollEvent(120));
      result.current.focusInput(f.field);
    });
    // Field bottom 462, unobstructed bottom 506 - 52: reveal precisely 8 points.
    expect(f.scrollTo).toHaveBeenCalledWith({ y: 128, animated: false });
    expect(f.input.focus).not.toHaveBeenCalled();
    expect(f.input.blur).not.toHaveBeenCalled();
    expect(f.input.clear).not.toHaveBeenCalled();
  });

  it('leaves a fully visible field and a blurred field alone', async () => {
    const f = fixture();
    f.move(200);
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(f.scroll, 52),
    );
    await act(() => result.current.focusInput(f.field));
    f.move(425);
    f.unfocus();
    await act(() => result.current.revealFocused());
    expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('uses fresh layout and inset measurements when the keyboard changes the available space', async () => {
    const f = fixture();
    f.move(400);
    const { result, rerender } = await renderHook(
      ({ inset }: { inset: number }) => useSymptomFocusReveal(f.scroll, inset),
      { initialProps: { inset: 52 } },
    );
    await act(() => result.current.focusInput(f.field));
    expect(f.scrollTo).not.toHaveBeenCalled();
    await rerender({ inset: 80 });
    expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 11, animated: false });
  });

  it('ignores a late measurement from an input that lost focus', async () => {
    const f = fixture();
    let measured:
      | ((x: number, y: number, width: number, height: number) => void)
      | undefined;
    f.input.measureInWindow.mockImplementation(callback => {
      measured = callback;
    });
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(f.scroll, 52),
    );
    await act(() => result.current.focusInput(f.field));
    await act(() => result.current.blurInput(f.field));
    await act(() => measured?.(35, 425, 160, 37));
    expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('remeasures on a keyboard event without turning scroll events into repeated reveal commands', async () => {
    const f = fixture();
    f.move(200);
    const listeners = new Map<string, () => void>();
    jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
      listeners.set(name, listener as () => void);
      return { remove: jest.fn() };
    });
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(f.scroll, 52),
    );
    await act(() => result.current.focusInput(f.field));
    f.move(425);
    await act(() => listeners.get('keyboardDidShow')?.());
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
    await act(() => result.current.onScroll(scrollEvent(8)));
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('uses the keyboard edge if it occludes the measured scroll viewport', async () => {
    const f = fixture();
    jest
      .spyOn(Keyboard, 'metrics')
      .mockReturnValue({ screenX: 0, screenY: 450, width: 402, height: 366 });
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(f.scroll, 52),
    );
    await act(() => result.current.focusInput(f.field));
    expect(f.scrollTo).toHaveBeenCalledWith({ y: 64, animated: false });
  });

  it('brings an input above the viewport back down using its actual content offset', async () => {
    const f = fixture();
    f.move(40);
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(f.scroll, 52),
    );
    await act(() => {
      result.current.onScroll(scrollEvent(120));
      result.current.focusInput(f.field);
    });
    expect(f.scrollTo).toHaveBeenCalledWith({ y: 98, animated: false });
  });

  it('discards an obsolete measurement after focus moves to another field', async () => {
    const first = fixture();
    const second = fixture();
    second.move(200);
    let measured:
      | ((x: number, y: number, width: number, height: number) => void)
      | undefined;
    first.input.measureInWindow.mockImplementation(callback => {
      measured = callback;
    });
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(first.scroll, 52),
    );
    await act(() => result.current.focusInput(first.field));
    await act(() => result.current.focusInput(second.field));
    await act(() => measured?.(35, 425, 160, 37));
    expect(first.scrollTo).not.toHaveBeenCalled();
  });

  it('does not repeat a correction for unchanged measurements or use invalid native geometry', async () => {
    const f = fixture();
    const { result } = await renderHook(() =>
      useSymptomFocusReveal(f.scroll, 52),
    );
    await act(() => result.current.focusInput(f.field));
    await act(() => result.current.revealFocused());
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
    f.move(Number.NaN);
    await act(() => result.current.revealFocused());
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
  });
});
