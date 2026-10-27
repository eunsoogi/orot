import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HostInstance, ViewStyle } from 'react-native';
import { resolveAdaptiveColumns } from '../layout/adaptiveColumnsPlan';
import { appColors } from '../layout/appColors';
import { useNavigationGeometry } from '../navigation/NavigationGeometryProvider';
import {
  useNavigationContentInset,
  useNavigationOcclusion,
} from '../navigation/useNavigationContentInset';
import { ConversationHistoryListPane } from './ConversationHistoryListPane';
import { ConversationHistoryPreview } from './ConversationHistoryPreview';
import type { ConversationSession } from './conversationSessions';
import type { ConversationHistoryRow } from './ConversationHistoryScreen';

/** Measures this screen's usable parent so Duo panels honor the actual native regions. */
export function ConversationHistoryLayout({
  deleted,
  onBack,
  onCreateSession,
  onDeleteSession,
  onSelectSession,
  onUndoRemove,
  rows,
  selectedSession,
}: {
  readonly deleted: boolean;
  readonly onBack: () => void;
  readonly onCreateSession: () => void;
  readonly onDeleteSession: (id: number) => void;
  readonly onSelectSession: (id: number) => void;
  readonly onUndoRemove: () => void;
  readonly rows: readonly ConversationHistoryRow[];
  readonly selectedSession: ConversationSession | null;
}) {
  const { fontScale, width } = useWindowDimensions();
  const occlusion = useNavigationOcclusion();
  const geometry = useNavigationGeometry();
  const inset = useNavigationContentInset();
  const hostRef = useRef<HostInstance | null>(null);
  const [measuredBounds, setMeasuredBounds] = useState<{
    readonly x: number;
    readonly width: number;
  } | null>(null);
  const [savedPreviewScroll, setSavedPreviewScroll] = useState({
    sessionId: selectedSession?.id ?? null,
    offset: 0,
  });
  const previewScrollOffset = useRef(0);
  const selectedSessionId = selectedSession?.id ?? null;
  const measureHost = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;

    // The native sensor reports window coordinates, so measure this same route-owned host.
    host.measureInWindow((x, _y, nextWidth) => {
      if (!Number.isFinite(x) || !Number.isFinite(nextWidth) || nextWidth <= 0)
        return;
      setMeasuredBounds(previous =>
        previous !== null &&
        Math.abs(previous.x - x) < 0.5 &&
        Math.abs(previous.width - nextWidth) < 0.5
          ? previous
          : { x, width: nextWidth },
      );
    });
  }, []);
  const plan = useMemo(
    () =>
      resolveAdaptiveColumns({
        windowWidth: width,
        fontScale,
        systemInsets: occlusion.systemInsets,
        viewportInsets: occlusion.viewportInsets,
        measuredBounds,
        safeAreaFrame: geometry?.safeAreaFrame,
        usableRegions: geometry?.usableRegions,
        hasNativeDivision: geometry?.reservedRegions.some(
          region => region.isActive && region.kind === 'division',
        ),
        hasNativeOcclusion: geometry?.reservedRegions.some(
          region => region.isActive && region.kind === 'occlusion',
        ),
        hasSecondary: true,
      }),
    [fontScale, geometry, measuredBounds, occlusion, width],
  );
  const previousColumnCount = useRef(plan.columns);

  useEffect(() => {
    measureHost();
  }, [
    fontScale,
    geometry,
    measureHost,
    occlusion.systemInsets.left,
    occlusion.systemInsets.right,
    occlusion.viewportInsets.left,
    occlusion.viewportInsets.right,
    width,
  ]);

  useLayoutEffect(() => {
    previewScrollOffset.current = 0;
    setSavedPreviewScroll(previous =>
      previous.sessionId === selectedSessionId && previous.offset === 0
        ? previous
        : { sessionId: selectedSessionId, offset: 0 },
    );
  }, [selectedSessionId]);

  useLayoutEffect(() => {
    const previousColumns = previousColumnCount.current;
    previousColumnCount.current = plan.columns;
    if (previousColumns === 2 && plan.columns === 1) {
      // The layout owner survives reflow, so save the preview offset before its ScrollView unmounts.
      setSavedPreviewScroll({
        sessionId: selectedSessionId,
        offset: previewScrollOffset.current,
      });
    }
  }, [plan.columns, selectedSessionId]);

  const rememberPreviewScrollOffset = useCallback((offset: number) => {
    if (Number.isFinite(offset))
      previewScrollOffset.current = Math.max(0, offset);
  }, []);

  const layoutStyle = useMemo<ViewStyle>(
    () => ({
      flexGrow: 1,
      minWidth: 0,
      minHeight: 0,
      flexDirection: plan.columns === 2 ? 'row' : 'column',
      width: Math.max(0, plan.contentWidth - plan.leadingInset),
      marginStart: plan.leadingInset,
      columnGap: plan.columns === 2 ? plan.columnGap : 0,
      rowGap: plan.columns === 1 ? plan.rowGap : 0,
    }),
    [plan],
  );
  const primaryStyle = useMemo<ViewStyle>(
    () => ({
      flexGrow: plan.columns === 1 ? 1 : 0,
      minWidth: 0,
      minHeight: 0,
      width: plan.primaryWidth,
    }),
    [plan],
  );
  const secondaryStyle = useMemo<ViewStyle>(
    () => ({
      flexGrow: plan.columns === 1 ? 1 : 0,
      minWidth: 0,
      minHeight: 0,
      width: plan.secondaryWidth,
    }),
    [plan],
  );
  const create = () => {
    onCreateSession();
    if (plan.columns === 1) onBack();
  };
  const select = (id: number) => {
    onSelectSession(id);
    // Compact history keeps its original return-to-conversation selection flow.
    if (plan.columns === 1) onBack();
  };

  return (
    <View style={[styles.screen, inset]} testID="conversation-history-screen">
      <View
        ref={hostRef}
        onLayout={measureHost}
        style={styles.measurementHost}
        testID="conversation-history-measurement-host"
      >
        <View
          style={[styles.layout, layoutStyle]}
          testID="conversation-history-layout"
        >
          <View
            style={[styles.panel, primaryStyle]}
            testID="conversation-history-layout-primary"
          >
            <ConversationHistoryListPane
              deleted={deleted}
              onCreateSession={create}
              onDeleteSession={onDeleteSession}
              onSelectSession={select}
              onUndoRemove={onUndoRemove}
              rows={rows}
            />
          </View>
          {plan.columns === 2 ? (
            <View
              style={[styles.panel, secondaryStyle]}
              testID="conversation-history-layout-secondary"
            >
              <ConversationHistoryPreview
                onScrollOffsetChange={rememberPreviewScrollOffset}
                scrollOffset={
                  savedPreviewScroll.sessionId === selectedSessionId
                    ? savedPreviewScroll.offset
                    : 0
                }
                session={selectedSession}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minWidth: 0, backgroundColor: appColors.background },
  measurementHost: { flex: 1, minWidth: 0, minHeight: 0 },
  layout: { flexGrow: 1, minWidth: 0, minHeight: 0 },
  panel: { flexDirection: 'column' },
});
