export interface ActiveTabOverlapSample {
  readonly sqlRun: string;
  readonly touchRun: string;
  readonly scrollRun: string;
  readonly statement: string;
  readonly result: 'row' | 'done' | 'error';
  readonly target: 'overview' | 'records' | 'appointments';
  readonly readyTarget: 'overview' | 'records' | 'appointments';
  readonly complete: boolean;
  readonly sqlStarted: number;
  readonly sqlFinished: number;
  readonly touch: number;
  readonly visible: number;
  readonly scrollStarted: number;
  readonly scrollFinished: number;
  readonly scrollOwnerBefore: string;
  readonly scrollOwnerAfter: string;
  readonly touchID: string;
  readonly scrollGesture: string;
  readonly scrollTouchBefore: string;
  readonly scrollTouchAfter: string;
  readonly scrollBefore: number;
  readonly scrollAfter: number;
}

/** Inputs are native monotonic timestamps from one identified run and SQL statement.
 * A missing or reordered event cannot establish a user interaction during SQL. */
export function observedActiveTabOverlap(
  sample: ActiveTabOverlapSample,
): boolean {
  const values = [
    sample.sqlStarted,
    sample.sqlFinished,
    sample.touch,
    sample.visible,
    sample.scrollStarted,
    sample.scrollFinished,
    sample.scrollBefore,
    sample.scrollAfter,
  ];
  return (
    sample.sqlRun.length > 0 &&
    sample.sqlRun.toLowerCase() === sample.touchRun.toLowerCase() &&
    sample.sqlRun.toLowerCase() === sample.scrollRun.toLowerCase() &&
    sample.statement.length > 0 &&
    sample.result !== 'error' &&
    sample.complete &&
    sample.target === sample.readyTarget &&
    sample.scrollOwnerBefore.length > 0 &&
    sample.scrollOwnerBefore !== '0' &&
    sample.scrollOwnerBefore === sample.scrollOwnerAfter &&
    sample.touchID.length > 0 &&
    sample.scrollGesture.length > 0 &&
    sample.scrollGesture !== sample.touchID &&
    sample.scrollGesture === sample.scrollTouchBefore &&
    sample.scrollGesture === sample.scrollTouchAfter &&
    values.every(Number.isFinite) &&
    sample.sqlStarted < sample.touch &&
    sample.touch < sample.sqlFinished &&
    sample.visible >= sample.touch &&
    sample.visible < sample.sqlFinished &&
    sample.scrollStarted >= sample.visible &&
    sample.scrollStarted < sample.scrollFinished &&
    sample.scrollFinished < sample.sqlFinished &&
    sample.scrollAfter !== sample.scrollBefore
  );
}
