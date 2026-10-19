const caseInsensitiveWarning = '[Ww][Aa][Rr][Nn][Ii][Nn][Gg]';
// Match line-leading React Native CLI `warn` output while keeping embedded
// standalone WARN case-sensitive so ordinary source text is not a diagnostic.
const warningMarker = new RegExp(
  `DVTAssertions: [Ww]arning|${caseInsensitiveWarning}:|^[ \t]*[Ww][Aa][Rr][Nn]\\b|(?:^|[^A-Za-z0-9_])WARN(?=$|[^A-Za-z0-9_])|\\[!\\]`,
  'g',
);
const ansiEscape = String.fromCharCode(0x1b);
const ansiControlSequence = new RegExp(`${ansiEscape}\\[[0-?]*[ -/]*[@-~]`, 'g');

/**
 * Count complete-line markers after joining chunks so split diagnostics match
 * their unsplit form.
 */
export function createWarningMarkerScanner() {
  const pending = { stdout: '', stderr: '' };
  let occurrences = 0;

  function countLine(line) {
    warningMarker.lastIndex = 0;
    // Normalize only the scanner input; the gate forwards the original bytes.
    const normalizedLine = line.replace(ansiControlSequence, '');
    while (warningMarker.exec(normalizedLine)) occurrences += 1;
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
    get occurrences() {
      return occurrences;
    },
  };
}
