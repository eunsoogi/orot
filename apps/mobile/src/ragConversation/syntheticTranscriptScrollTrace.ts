import { observeNavigationTest } from '../navigation/navigationTestObservation';

type Geometry = {
  readonly width?: number;
  readonly height?: number;
  readonly contentHeight?: number;
  readonly offset?: number;
};

type Boundary =
  | 'layout'
  | 'content-size'
  | 'scroll-before'
  | 'scroll-after'
  | 'drag-begin'
  | 'drag-end'
  | 'inertia-begin'
  | 'inertia-end'
  | 'status-bar-top-completed'
  | 'follow-to-offset'
  | 'follow-to-end';

type Sink = (
  boundary: Boundary,
  geometry: Geometry | null,
  followsBottom: boolean,
  interacting: boolean | null,
  requestedOffset: number | null,
) => void;

let sink: Sink | undefined;

// No trace payloads are constructed until the isolated synthetic entry registers.
export function syntheticTranscriptScrollTrace() {
  return sink;
}

function measured(value: number | undefined | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.round(value * 10) / 10)
    : null;
}

/** Test entry only; capture geometry and order, never text, IDs, or inferred intent. */
export function registerSyntheticTranscriptScrollTrace() {
  let order = 0;
  const trace: Sink = (
    boundary,
    geometry,
    followsBottom,
    interacting,
    requestedOffset,
  ) => {
    observeNavigationTest('synthetic-transcript-scroll', {
      boundary,
      order: String(++order),
      width: measured(geometry?.width),
      height: measured(geometry?.height),
      contentHeight: measured(geometry?.contentHeight),
      offset: measured(geometry?.offset),
      followsBottom,
      interacting,
      requestedOffset: measured(requestedOffset),
    });
  };
  sink = trace;
  return () => {
    if (sink === trace) sink = undefined;
  };
}
