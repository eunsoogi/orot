import { useRef, type ComponentRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { AppText } from '../layout/AppText';
import { ConversationEdgeGradient } from '../layout/ConversationEdgeGradient';
import { t } from '../i18n';

export interface VoiceTranscriptLine {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** Three scaled lines remain visible; scrolling back suspends following new speech. No transcript is persisted here. */
export function VoiceTranscriptViewport({
  lines,
}: {
  readonly lines: readonly VoiceTranscriptLine[];
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const following = useRef(true);
  const dragging = useRef(false);
  const geometry = useRef<{
    offset: number;
    height: number;
    content: number;
  } | null>(null);
  const { fontScale } = useWindowDimensions();
  if (!lines.length) {
    following.current = true;
    dragging.current = false;
    geometry.current = null;
  }
  const follow = () => {
    if (following.current && !dragging.current)
      scroll.current?.scrollToEnd({ animated: false });
  };
  return (
    <View
      testID="voice-transcript-viewport"
      style={[styles.viewport, { height: 72 * Math.min(fontScale, 2) + 32 }]}
    >
      <ScrollView
        ref={scroll}
        testID="voice-transcript-scroll"
        nestedScrollEnabled
        contentContainerStyle={styles.content}
        onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } =
            event.nativeEvent;
          const previous = geometry.current;
          const current = {
            offset: contentOffset.y,
            height: layoutMeasurement.height,
            content: contentSize.height,
          };
          geometry.current = current;
          // A resize/content event at the same (or clamped) offset is not reader intent.
          // Preserve drag/momentum and unchanged-geometry accessibility scrolling below.
          if (
            previous &&
            !dragging.current &&
            (previous.height !== current.height ||
              previous.content !== current.content) &&
            Math.abs(
              current.offset -
                Math.min(
                  Math.max(0, previous.offset),
                  Math.max(0, current.content - current.height),
                ),
            ) < 1
          )
            return;
          following.current =
            current.content - current.offset - current.height <= 24;
        }}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
        onScrollEndDrag={() => {
          dragging.current = false;
        }}
        onMomentumScrollBegin={() => {
          dragging.current = true;
        }}
        onMomentumScrollEnd={() => {
          dragging.current = false;
        }}
        scrollEventThrottle={16}
        onLayout={follow}
        onContentSizeChange={follow}
      >
        {lines.map(line => (
          <AppText key={line.id} maxFontSizeMultiplier={2} style={styles.line}>
            {line.role === 'user' ? t('realtimeDisplay.user') : 'AI'}:{' '}
            {line.text}
          </AppText>
        ))}
      </ScrollView>
      {/* The opaque accessibility fallback occupies the same content gutter, not a control. */}
      <View pointerEvents="none" style={styles.fade}>
        <ConversationEdgeGradient edge="top" testID="voice-transcript-fade" />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  viewport: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  content: { paddingVertical: 16 },
  line: { fontSize: 18, lineHeight: 24, textAlign: 'center' },
  fade: { position: 'absolute', top: 0, left: 0, right: 0, height: 16 },
});
