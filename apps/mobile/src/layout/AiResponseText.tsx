import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { Animated, Text } from 'react-native';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
import { AppText } from './AppText';

type Segment = { id: number; text: string; settled: boolean };
type Props = Omit<ComponentProps<typeof AppText>, 'children'> & {
  children: string;
};

/** New output fades independently; completed text keeps its opacity within one text passage. */
export function AiResponseText({ children: text, ...props }: Props) {
  const reduceMotion = useContext(NavigationMotionContext);
  const [state, setState] = useState({
    text,
    prefix: '',
    nextId: 1,
    segments: text ? [{ id: 0, text, settled: false }] : ([] as Segment[]),
  });
  // A correction may replace its draft. Only an actual suffix reuses the old segments.
  if (state.text !== text) {
    const append = text.startsWith(state.text);
    const suffix = append ? text.slice(state.text.length) : text;
    setState({
      text,
      prefix: append ? state.prefix : '',
      nextId: state.nextId + 1,
      segments: [
        ...(append ? state.segments : []),
        ...(suffix ? [{ id: state.nextId, text: suffix, settled: false }] : []),
      ],
    });
  }
  const settle = useCallback((id: number) => {
    setState(current => {
      const segments = current.segments.map(segment =>
        segment.id === id ? { ...segment, settled: true } : segment,
      );
      let prefix = current.prefix;
      // Coalesce finished leading fragments so long streams do not retain a span per token.
      while (segments[0]?.settled) prefix += segments.shift()!.text;
      return { ...current, prefix, segments };
    });
  }, []);
  return (
    <AppText {...props}>
      {state.prefix}
      {state.segments.map(segment => (
        <FadeSegment
          key={segment.id}
          segment={segment}
          reduceMotion={reduceMotion}
          onSettled={settle}
        />
      ))}
    </AppText>
  );
}

function FadeSegment({
  segment,
  reduceMotion,
  onSettled,
}: {
  segment: Segment;
  reduceMotion: boolean;
  onSettled: (id: number) => void;
}) {
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const [alpha, setAlpha] = useState(reduceMotion ? 1 : 0);
  // This per-segment opacity follows animation state and therefore cannot be a static StyleSheet entry.
  const textStyle = useMemo(
    () => ({ opacity: reduceMotion ? 1 : alpha }),
    [alpha, reduceMotion],
  );
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      onSettled(segment.id);
      return;
    }
    // iOS nested Text is a virtual attributed range, not a native view/layer.
    // Commit its glyph opacity through React; a view-only native animation cannot paint it.
    const listener = opacity.addListener(({ value }) => setAlpha(value));
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 320,
      useNativeDriver: false,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (finished) onSettled(segment.id);
    });
    return () => {
      animation.stop();
      opacity.removeListener(listener);
    };
  }, [opacity, reduceMotion, segment.id, onSettled]);
  return (
    <Text testID="ai-response-fragment" style={textStyle}>
      {segment.text}
    </Text>
  );
}
