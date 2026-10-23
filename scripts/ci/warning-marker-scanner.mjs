const caseInsensitiveWarning = '[Ww][Aa][Rr][Nn][Ii][Nn][Gg]';
// Match line-leading React Native CLI `warn` output while keeping embedded
// standalone WARN case-sensitive so ordinary source text is not a diagnostic.
const warningMarker = new RegExp(
  `DVTAssertions: [Ww]arning|${caseInsensitiveWarning}:|^[ \t]*[Ww][Aa][Rr][Nn]\\b|(?:^|[^A-Za-z0-9_])WARN(?=$|[^A-Za-z0-9_])|\\[!\\]`,
  'g',
);
const ansiEscape = String.fromCharCode(0x1b);
const ansiControlSequence = new RegExp(`${ansiEscape}\\[[0-?]*[ -/]*[@-~]`, 'g');
// Xcode 27 emits this exact notice when no AppIntents.framework is linked; keep it visible but non-blocking.
const documentedAppIntentsNotice =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} appintentsmetadataprocessor\[\d+:\d+\] warning: Metadata extraction skipped, no AppIntents\.framework dependency found$/;
// These pinned React Native podspec notices describe the required Debug/Release
// archive-switch phases. Accept only the complete one-per-pod set; changed,
// duplicated, or unrelated CocoaPods notices remain blocking.
const documentedCocoaPodsPhaseNotices = [
  '[!] React-Core-prebuilt has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
  '[!] ReactNativeDependencies has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
  '[!] hermes-engine has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
];

/**
 * Count complete-line markers after joining chunks so split diagnostics match
 * their unsplit form.
 */
export function createWarningMarkerScanner() {
  const pending = { stdout: '', stderr: '' };
  const cocoaPodsPhaseNoticeCounts = new Map();
  let occurrences = 0;
  let acceptedOccurrences = 0;
  let blockingOccurrences = 0;
  let finalized = false;

  function countLine(line) {
    warningMarker.lastIndex = 0;
    // Normalize only the scanner input; the gate forwards the original bytes.
    const normalizedLine = line.replace(ansiControlSequence, '');
    if (documentedAppIntentsNotice.test(normalizedLine)) {
      occurrences += 1;
      acceptedOccurrences += 1;
      return;
    }
    if (documentedCocoaPodsPhaseNotices.includes(normalizedLine)) {
      occurrences += 1;
      cocoaPodsPhaseNoticeCounts.set(
        normalizedLine,
        (cocoaPodsPhaseNoticeCounts.get(normalizedLine) ?? 0) + 1,
      );
      return;
    }
    let lineOccurrences = 0;
    while (warningMarker.exec(normalizedLine)) lineOccurrences += 1;
    occurrences += lineOccurrences;
    blockingOccurrences += lineOccurrences;
  }

  return {
    scan(channel, chunk) {
      if (!(channel in pending)) throw new Error('Unknown warning output stream');
      const lines = (pending[channel] + chunk.toString('utf8')).split(/\r\n|\n|\r/);
      pending[channel] = lines.pop() ?? '';
      for (const line of lines) countLine(line);
    },
    flush(channel) {
      if (!(channel in pending)) throw new Error('Unknown warning output stream');
      if (pending[channel]) countLine(pending[channel]);
      pending[channel] = '';
    },
    finalize() {
      if (finalized) return;
      finalized = true;

      if (cocoaPodsPhaseNoticeCounts.size === 0) return;
      const completeNoticeSet =
        cocoaPodsPhaseNoticeCounts.size === documentedCocoaPodsPhaseNotices.length &&
        documentedCocoaPodsPhaseNotices.every(
          (notice) => cocoaPodsPhaseNoticeCounts.get(notice) === 1,
        );
      const noticeOccurrences = [...cocoaPodsPhaseNoticeCounts.values()].reduce(
        (total, count) => total + count,
        0,
      );

      if (completeNoticeSet) acceptedOccurrences += noticeOccurrences;
      else blockingOccurrences += noticeOccurrences;
    },
    get occurrences() {
      return occurrences;
    },
    get acceptedOccurrences() {
      return acceptedOccurrences;
    },
    get blockingOccurrences() {
      return blockingOccurrences;
    },
  };
}
