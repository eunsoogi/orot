import { useRef } from 'react';
import type {
  GestureResponderEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
} from 'react-native';
import { observeNavigationTest } from '../navigation/navigationTestObservation';

/** Passively records selected structure through the opted-in test sink without claiming native gesture ownership. */
export default function useSymptomScrollDiagnostics() {
  const diagnosticScroll = useRef<ScrollViewInstance>(null);
  const lastScrollEvent = useRef<NativeScrollEvent | null>(null);
  // Temporary structural-only observation uses the opted-in test sink; it requests no responder ownership or scroll commands.
  const observeScroll = (
    phase: string | undefined,
    fields: Record<string, unknown>,
  ) => {
    observeNavigationTest('symptom-scroll-diagnostic', {
      // Null records an unavailable RN event type without inventing a name.
      phase: phase ?? null,
      payload: JSON.stringify({
        ...fields,
        scrollHostReactTag:
          diagnosticScroll.current?.getScrollableNode() ?? null,
        latestScrollEvent: lastScrollEvent.current,
        nativeViewIdentity: 'unavailable-through-public-RN-events',
      }),
    });
  };
  const observeScrollEvent = ({
    type,
    nativeEvent: event,
  }: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Select geometry explicitly: no input values, text, labels, or arbitrary event payloads may enter the log.
    lastScrollEvent.current = {
      contentOffset: event.contentOffset,
      contentSize: event.contentSize,
      contentInset: event.contentInset,
      layoutMeasurement: event.layoutMeasurement,
      zoomScale: event.zoomScale,
    };
    observeScroll(type, {});
  };
  const observeTouch = ({
    type,
    nativeEvent: event,
  }: GestureResponderEvent) => {
    // RN target tags and responder callbacks are evidence at the RN boundary, not UIKit hit-test or pan-recognizer identity.
    observeScroll(type, {
      touchTargetReactTag: event.target,
      pageX: event.pageX,
      pageY: event.pageY,
      nativeTouchTimestamp: event.timestamp,
    });
  };
  return { diagnosticScroll, observeScroll, observeScrollEvent, observeTouch };
}
