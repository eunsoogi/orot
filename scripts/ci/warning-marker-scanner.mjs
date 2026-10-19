const caseInsensitiveWarning = '[Ww][Aa][Rr][Nn][Ii][Nn][Gg]';
// Match `warning:` case-insensitively; keep standalone WARN case-sensitive so
// ordinary source text such as console.warn is not a build diagnostic.
const warningMarker = new RegExp(
  `DVTAssertions: [Ww]arning|${caseInsensitiveWarning}:|(?:^|[^A-Za-z0-9_])WARN(?=$|[^A-Za-z0-9_])|\\[!\\]`,
  'g',
);

/**
 * Count complete-line markers after joining chunks so split diagnostics match
 * their unsplit form.
 */
export function createWarningMarkerScanner() {
  const pending = { stdout: '', stderr: '' };
  let occurrences = 0;

  function countLine(line) {
    warningMarker.lastIndex = 0;
    while (warningMarker.exec(line)) occurrences += 1;
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
