import { useCallback, useState } from 'react';
import type { VoiceTranscriptLine } from './VoiceTranscriptViewport';

/** Ephemeral display only, bounded like Realtime's transcript and cleared when call ownership changes. */
export function useVoiceTranscript() {
  const [lines, setLines] = useState<readonly VoiceTranscriptLine[]>([]);
  const append = useCallback((line: VoiceTranscriptLine) => {
    setLines(prior =>
      [
        ...prior.filter(item => item.id !== line.id),
        { ...line, text: line.text.slice(0, 12000) },
      ].slice(-20),
    );
  }, []);
  const clear = useCallback(() => setLines([]), []);
  return { lines, append, clear };
}
