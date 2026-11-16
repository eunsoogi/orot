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
  const { fontScale } = useWindowDimensions();
  if (!lines.length) following.current = true;
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
          following.current =
            contentSize.height - contentOffset.y - layoutMeasurement.height <=
            24;
        }}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (following.current)
            scroll.current?.scrollToEnd({ animated: false });
        }}
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
