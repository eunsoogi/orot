import { useEffect, useRef } from 'react';
import { AppState, NativeModules } from 'react-native';

type Extent = { readonly width: number; readonly height: number };
type FrameState = 'missing' | 'collapsed' | 'positive';
type Phase = 'active' | 'inactive' | 'background';
type Stage = 'foreground' | 'planned_frame' | 'native_frame' | 'root_cover';
type Status = FrameState | Phase | 'pending' | 'settled';
type Observer = (stage: Stage, status: Status) => void;

function observe(stage: Stage, status: Status) {
  // Use the explicit local launch flag; neither route IDs nor dimensions cross the bridge.
  try {
    const sink = NativeModules.OrotProviderDiagnostics;
    if (sink?.enabled === true) sink.report('navigation', stage, status);
  } catch {
    // Diagnostic code cannot interfere with the active navigation route.
  }
}

function classified(frame: Extent | null | undefined): FrameState {
  if (!frame || !Number.isFinite(frame.width) || !Number.isFinite(frame.height))
    return 'missing';
  return frame.width > 0 && frame.height > 0 ? 'positive' : 'collapsed';
}

/** Coalesce repeated layout passes, but re-observe the retained result on a new lifecycle phase. */
export function createNavigationFrameDiagnostic(report: Observer) {
  let phase: Phase | undefined;
  let signature: string | undefined;
  return (
    planned: Extent | null | undefined,
    measured: Extent | null | undefined,
    nextPhase?: string,
  ) => {
    if (
      (nextPhase === 'active' ||
        nextPhase === 'inactive' ||
        nextPhase === 'background') &&
      phase !== nextPhase
    ) {
      phase = nextPhase;
      signature = undefined;
      report('foreground', phase);
    }
    const plan = classified(planned);
    const native = classified(measured);
    const next = plan + ':' + native;
    if (signature === next) return;
    signature = next;
    report('planned_frame', plan);
    report('native_frame', native);
  };
}

export function useNavigationFrameDiagnostic(
  active: boolean,
  planned: Extent | null | undefined,
  measured: Extent | null | undefined,
) {
  const frame = useRef({ planned, measured });
  frame.current = { planned, measured };
  const record = useRef<ReturnType<
    typeof createNavigationFrameDiagnostic
  > | null>(null);
  useEffect(() => {
    if (!active || NativeModules.OrotProviderDiagnostics?.enabled !== true)
      return;
    const report = createNavigationFrameDiagnostic(observe);
    record.current = report;
    const sample = (phase?: string) =>
      report(frame.current.planned, frame.current.measured, phase);
    sample(AppState.currentState ?? undefined);
    const subscription = AppState.addEventListener('change', sample);
    return () => {
      record.current = null;
      subscription.remove();
    };
  }, [active]);
  useEffect(() => {
    record.current?.(planned, measured);
  }, [planned, measured]);
}

export function useNavigationCoverDiagnostic(pending: boolean) {
  useEffect(() => {
    // JS cover state is not the actual compositor opacity; report it precisely as pending/settled.
    observe('root_cover', pending ? 'pending' : 'settled');
  }, [pending]);
}
