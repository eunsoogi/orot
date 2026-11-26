import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AppState,
  Platform,
  requireNativeComponent,
  UIManager,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';

type CoverageEvent = {
  generation: number;
  kind: 'bound' | 'covered' | 'localized' | 'detached';
};
type NativeProps = ViewProps & {
  presentationGeneration?: number;
  onRecordsCoverage: (event: NativeSyntheticEvent<CoverageEvent>) => void;
};

const name = 'RecordsSnapshotSurface';
const Surface =
  Platform.OS === 'ios' && UIManager.hasViewManagerConfig?.(name)
    ? requireNativeComponent<NativeProps>(name)
    : null;

export const hasRecordsNativeSnapshotSurface = Surface !== null;

/** One native window owner around the existing React scores and rows. */
export function RecordsSnapshotSurface({
  children,
  revision,
  active,
  onBound,
  neutral,
  terminal,
  neutralStyle,
  ...props
}: ViewProps & {
  children: ReactNode;
  revision?: string;
  active: boolean;
  onBound(bound: boolean): void;
  neutral: ReactNode;
  terminal: boolean;
  neutralStyle?: ViewProps['style'];
}) {
  const membership = useRef<{ generation: number; bound: boolean } | undefined>(
    undefined,
  );
  const lastPaint = useRef<string | undefined>(undefined);
  const beforeSuspension = useRef<{ revision?: string } | undefined>(undefined);
  const [covered, setCovered] = useState<{
    generation: number;
    revision?: string;
    local: boolean;
    baselineKnown: boolean;
  }>();
  useLayoutEffect(() => {
    const phase = (next: string) => {
      if (next !== 'active' && !beforeSuspension.current)
        beforeSuspension.current = { revision: lastPaint.current };
    };
    const subscription = AppState.addEventListener('change', phase);
    phase(AppState.currentState ?? 'unknown');
    return () => subscription.remove();
  }, []);
  const onCoverage = useCallback(
    (event: NativeSyntheticEvent<CoverageEvent>) => {
      const { generation, kind } = event.nativeEvent;
      if (!Number.isSafeInteger(generation) || generation < 1) return;
      if (kind === 'bound' || kind === 'detached') {
        const current = membership.current;
        if (kind === 'bound' && (!current || generation > current.generation)) {
          membership.current = { generation, bound: true };
          onBound(true);
        } else if (
          kind === 'detached' &&
          current?.generation === generation &&
          current.bound
        ) {
          membership.current = { generation, bound: false };
          onBound(false);
          setCovered(undefined);
        }
        return;
      }
      if (kind !== 'covered' && kind !== 'localized') return;
      const baseline = beforeSuspension.current;
      const previousRevision = baseline?.revision ?? lastPaint.current;
      setCovered(previous => {
        if (previous && previous.generation > generation) return previous;
        if (previous?.generation === generation) {
          return kind === 'localized' ? { ...previous, local: true } : previous;
        }
        return {
          generation,
          revision: previousRevision,
          local: kind === 'localized',
          baselineKnown: Boolean(baseline),
        };
      });
    },
    [onBound],
  );
  const locallyProtected =
    active && covered?.local && AppState.currentState === 'active';
  const fresh = revision !== undefined && revision !== covered?.revision;
  // An untracked native cover (for example a protection-only lock) must not
  // treat a delayed latest React revision as native-current. A neutral Retry
  // has no protected rows and can be acknowledged independently.
  const neutralPaint =
    locallyProtected && (terminal || (!fresh && !covered.baselineKnown));
  const acknowledgment =
    locallyProtected && (neutralPaint || fresh)
      ? covered.generation
      : undefined;
  useLayoutEffect(() => {
    if (!active || revision === undefined || AppState.currentState !== 'active')
      return;
    if (acknowledgment !== undefined) beforeSuspension.current = undefined;
    if (!beforeSuspension.current || acknowledgment !== undefined)
      lastPaint.current = revision;
  }, [acknowledgment, active, revision]);
  if (!active || !Surface) return <View {...props}>{children}</View>;
  return (
    <Surface
      {...props}
      {...(neutralPaint && {
        pointerEvents: 'auto' as const,
        accessibilityElementsHidden: false,
        importantForAccessibility: 'auto' as const,
        style: neutralStyle,
      })}
      presentationGeneration={acknowledgment}
      onRecordsCoverage={onCoverage}
    >
      {neutralPaint ? neutral : children}
    </Surface>
  );
}
