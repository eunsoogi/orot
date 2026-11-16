import { useContext, useEffect, useState, type ComponentProps } from 'react';
import { Easing, Text } from 'react-native';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
import { AppText } from './AppText';

type Segment = { id: number; text: string; startedAt: number };
type Props = Omit<ComponentProps<typeof AppText>, 'children'> & {
  children: string;
};
const fadeDuration = 320;
const frameDuration = 16;
// Match Animated.timing's default ease-in/out without a driver per fragment.
const fadeEasing = Easing.inOut(Easing.ease);

/** One clock paints all new glyph ranges; completed text never fades again. */
export function AiResponseText({ children: text, ...props }: Props) {
  const reduceMotion = useContext(NavigationMotionContext);
  const [state, setState] = useState(() => ({
    text,
    prefix: '',
    nextId: 1,
    now: performance.now(),
    segments: text
      ? [{ id: 0, text, startedAt: performance.now() }]
      : ([] as Segment[]),
  }));
  // Draft replacement discards old ranges, while appended output keeps its own
  // start time. Text remains selectable inside one native attributed passage.
  if (state.text !== text) {
    const append = text.startsWith(state.text);
    const suffix = append ? text.slice(state.text.length) : text;
    setState({
      ...state,
      text,
      prefix: append ? state.prefix : '',
      nextId: state.nextId + 1,
      segments: [
        ...(append ? state.segments : []),
        ...(suffix
          ? [{ id: state.nextId, text: suffix, startedAt: performance.now() }]
          : []),
      ],
    });
  }
  const active = state.segments.length > 0;
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const now = performance.now();
      setState(current => {
        let prefix = current.prefix;
        const segments = current.segments.filter(segment => {
          if (reduceMotion || now - segment.startedAt >= fadeDuration) {
            prefix += segment.text;
            return false;
          }
          return true;
        });
        return { ...current, now, prefix, segments };
      });
    };
    if (reduceMotion) {
      tick();
      return;
    }
    // iOS nested Text has no independent native layer. One JS frame publication
    // replaces one Animated.Value listener/setState per overlapping suffix.
    // Lifecycle cleanup stops the clock on unmount or once all ranges settle.
    const timer = setInterval(tick, frameDuration);
    return () => clearInterval(timer);
  }, [active, reduceMotion]);
  return (
    <AppText {...props}>
      {state.prefix}
      {state.segments.map(segment => {
        // Opacity is frame-derived data, not a static stylesheet constant.
        const opacity = reduceMotion
          ? 1
          : fadeEasing(
              Math.min(
                1,
                Math.max(0, (state.now - segment.startedAt) / fadeDuration),
              ),
            );
        return (
          <Text
            key={segment.id}
            testID="ai-response-fragment"
            style={{ opacity }}
          >
            {segment.text}
          </Text>
        );
      })}
    </AppText>
  );
}
