import Graphemer from 'graphemer';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { VoiceTranscriptLine } from './VoiceTranscriptViewport';

const graphemes = new Graphemer();
const fadeMs = 180;
const staggerMs = 18;
const maxStaggerMs = 180;

export type CaptionRun = { text: string; alpha: number };

type Glyph = { text: string; startsAt?: number };
type Caption = { text: string; glyphs: Glyph[]; endsAt: number };

export function captionKey(line: VoiceTranscriptLine) {
  return line.role + ':' + line.id;
}

function useCaptionMotionAllowed() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      reduced => {
        changed = true;
        if (live) setAllowed(!reduced);
      },
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      reduced => {
        if (live && !changed) setAllowed(!reduced);
      },
      () => undefined,
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return allowed;
}

/** Retain the entrance time of unchanged edges, including a corrected streaming tail.
 * Compression limits the delay of a large text batch without staging extra text nodes.
 */
function updateCaption(
  text: string,
  before: Caption | undefined,
  entersAt: number | undefined,
): Caption {
  if (before?.text === text && (entersAt !== undefined || before.endsAt === 0))
    return before;
  const next = graphemes.splitGraphemes(text);
  const prior = before?.glyphs ?? [];
  let prefix = 0;
  while (prefix < next.length && next[prefix] === prior[prefix]?.text) prefix++;
  let suffix = 0;
  while (
    suffix < next.length - prefix &&
    suffix < prior.length - prefix &&
    next[next.length - 1 - suffix] === prior[prior.length - 1 - suffix]?.text
  )
    suffix++;
  const rawStep = maxStaggerMs / Math.max(1, next.length - prefix - suffix - 1);
  const step = Math.min(staggerMs, rawStep);
  let endsAt = 0;
  const glyphs = next.map((value, index): Glyph => {
    if (entersAt === undefined) return { text: value };
    const candidate =
      index < prefix
        ? prior[index]
        : index >= next.length - suffix
          ? prior[prior.length - (next.length - index)]
          : undefined;
    const startsAt = candidate
      ? candidate.startsAt
      : entersAt + (index - prefix) * step;
    if (startsAt !== undefined) endsAt = Math.max(endsAt, startsAt + fadeMs);
    return { text: value, startsAt };
  });
  return { text, glyphs, endsAt };
}

/** One clock for the viewport; seed mounted captions and consume disabled deltas at full opacity. */
export function useVoiceCaptionFade(lines: readonly VoiceTranscriptLine[]) {
  const allowed = useCaptionMotionAllowed();
  const previous = useRef<Map<string, Caption>>(new Map());
  const seeded = useRef(false);
  const [frame, setFrame] = useState(() => ({
    now: performance.now(),
    captions: new Map<string, Caption>(),
  }));
  useLayoutEffect(() => {
    const now = performance.now();
    const captions = new Map<string, Caption>();
    let end = 0;
    for (const line of lines) {
      const key = captionKey(line);
      const before = previous.current.get(key);
      const caption = updateCaption(
        line.text,
        before,
        seeded.current && allowed ? now : undefined,
      );
      captions.set(key, caption);
      end = Math.max(end, caption.endsAt);
    }
    previous.current = captions;
    seeded.current = true;
    setFrame({ now, captions });
    if (end <= now) return;
    let request: number;
    const tick = () => {
      const paintedAt = performance.now();
      setFrame({ now: paintedAt, captions });
      if (paintedAt < end) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [allowed, lines]);

  return (line: VoiceTranscriptLine) => {
    const caption = frame.captions.get(captionKey(line));
    if (!allowed || caption?.text !== line.text || caption.endsAt <= frame.now)
      return undefined;
    const runs: CaptionRun[] = [];
    for (const glyph of caption.glyphs) {
      const elapsed =
        glyph.startsAt === undefined ? fadeMs : frame.now - glyph.startsAt;
      // Nearby glyphs can share a native text run; the text still wraps as one paragraph.
      const progress = Math.max(0, Math.min(1, elapsed / fadeMs));
      const alpha = Math.round((Math.round(progress * 16) * 255) / 16);
      const last = runs.at(-1);
      if (last?.alpha === alpha) last.text += glyph.text;
      else runs.push({ text: glyph.text, alpha });
    }
    return runs;
  };
}
