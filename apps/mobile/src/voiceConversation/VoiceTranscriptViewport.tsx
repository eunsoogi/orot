import { memo, useRef, type ComponentRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  useColorScheme,
} from 'react-native';
import { useAssistantAppearance } from '../assistantAppearance/AssistantAppearanceProvider';
import { defaultAssistantName } from '../assistantAppearance/appearance';
import { AppText } from '../layout/AppText';
import { appColorPalettes } from '../layout/appColors';
import { ConversationEdgeGradient } from '../layout/ConversationEdgeGradient';
import { t } from '../i18n';
import {
  captionKey,
  useVoiceCaptionFade,
  type CaptionRun,
} from './voiceCaptionFade';

export interface VoiceTranscriptLine {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** Five scaled lines remain visible; scrolling back suspends following new speech. No transcript is persisted here. */
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
  const appearance = useAssistantAppearance();
  const name = appearance?.value.name ?? defaultAssistantName;
  const textColor =
    appColorPalettes[useColorScheme() === 'dark' ? 'dark' : 'light'].text;
  const captionRuns = useVoiceCaptionFade(lines);
  const lineHeight = 24 * Math.min(fontScale, 2);
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
      style={[styles.viewport, { height: 5 * lineHeight + 32 }]}
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
        {lines.map((line, index) => {
          const speaker =
            line.role === 'user' ? t('realtimeDisplay.user') : name;
          const speakerChanged =
            index > 0 && lines[index - 1]?.role !== line.role;
          return (
            <VoiceCaptionLine
              key={captionKey(line)}
              speaker={speaker}
              text={line.text}
              runs={captionRuns(line)}
              textColor={textColor}
              gap={speakerChanged ? lineHeight : undefined}
            />
          );
        })}
      </ScrollView>
      {/* The opaque accessibility fallback occupies the same content gutter, not a control. */}
      <View pointerEvents="none" style={[styles.fade, styles.fadeTop]}>
        <ConversationEdgeGradient edge="top" testID="voice-transcript-fade" />
      </View>
      <View pointerEvents="none" style={[styles.fade, styles.fadeBottom]}>
        <ConversationEdgeGradient
          edge="bottom"
          testID="voice-transcript-fade-bottom"
        />
      </View>
    </View>
  );
}
// Animate inline foreground runs, not opacity on the entire wrapping paragraph.
const VoiceCaptionLine = memo(function VoiceCaptionLine({
  speaker,
  text,
  runs,
  textColor,
  gap,
}: {
  speaker: string;
  text: string;
  runs?: readonly CaptionRun[];
  textColor: string;
  gap?: number;
}) {
  return (
    <AppText
      accessible
      accessibilityLabel={speaker + ': ' + text}
      maxFontSizeMultiplier={2}
      style={[styles.line, gap !== undefined && { marginTop: gap }]}
      testID="voice-transcript-line"
    >
      <AppText maxFontSizeMultiplier={2} style={styles.speaker}>
        {speaker}:
      </AppText>{' '}
      {runs
        ? runs.map(({ text: runText, alpha }, run) =>
            alpha === 255 ? (
              runText
            ) : (
              <AppText
                key={run}
                style={{
                  color: textColor + alpha.toString(16).padStart(2, '0'),
                }}
                testID="voice-transcript-fading-text"
              >
                {runText}
              </AppText>
            ),
          )
        : text}
    </AppText>
  );
});

const styles = StyleSheet.create({
  viewport: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  content: { paddingVertical: 16 },
  line: { fontSize: 18, lineHeight: 24, textAlign: 'center' },
  speaker: { fontWeight: '700' },
  fade: { position: 'absolute', left: 0, right: 0, height: 16 },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0 },
});
