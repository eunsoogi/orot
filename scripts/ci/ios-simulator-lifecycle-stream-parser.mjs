const maxStartupOutputBytes = 4096;

function isStreamHeaderLine(line) {
  return (
    line.every((byte) => byte <= 0x7f) &&
    /^Timestamp\s+Ty Process\[PID:TID\]/.test(line.toString('ascii'))
  );
}

/**
 * Discard startup lines until the initialized log-stream header; retain raw event bytes.
 * Only an incomplete startup line is buffered so chunk boundaries cannot invent a line start.
 */
export function createIosSimulatorLifecycleStreamParser({
  onEvents,
  onReady,
  onStartupOutputTruncated,
}) {
  let startupLine = Buffer.alloc(0);
  let startupOutputBytes = 0;
  let streamReady = false;
  let discardingLongLine = false;
  let truncationReported = false;

  const countStartupBytes = (count) => {
    startupOutputBytes += count;
    if (!truncationReported && startupOutputBytes > maxStartupOutputBytes) {
      truncationReported = true;
      onStartupOutputTruncated();
    }
  };

  return (chunk) => {
    const bytes = Buffer.from(chunk);
    if (streamReady) {
      if (bytes.length > 0) onEvents(bytes);
      return;
    }

    let priorLine = startupLine;
    let input = Buffer.concat([priorLine, bytes]);
    let skippedBytes = 0;
    if (discardingLongLine) {
      const newline = bytes.indexOf(0x0a);
      if (newline < 0) {
        countStartupBytes(bytes.length);
        return;
      }
      skippedBytes = newline + 1;
      countStartupBytes(skippedBytes);
      priorLine = Buffer.alloc(0);
      input = bytes.subarray(skippedBytes);
      startupLine = Buffer.alloc(0);
      discardingLongLine = false;
    }

    let lineStart = 0;
    while (lineStart < input.length) {
      const lineEnd = input.indexOf(0x0a, lineStart);
      if (lineEnd < 0) break;
      const contentEnd = lineEnd > lineStart && input[lineEnd - 1] === 0x0d ? lineEnd - 1 : lineEnd;
      if (isStreamHeaderLine(input.subarray(lineStart, contentEnd))) {
        const eventOffset = lineEnd + 1;
        countStartupBytes(Math.max(0, eventOffset - priorLine.length));
        streamReady = true;
        onReady();
        const eventBytes = input.subarray(eventOffset);
        if (eventBytes.length > 0) onEvents(Buffer.from(eventBytes));
        startupLine = Buffer.alloc(0);
        return;
      }
      lineStart = lineEnd + 1;
    }

    countStartupBytes(bytes.length - skippedBytes);
    const incompleteLine = input.subarray(lineStart);
    if (incompleteLine.length > maxStartupOutputBytes) {
      startupLine = Buffer.alloc(0);
      discardingLongLine = true;
      if (!truncationReported) {
        truncationReported = true;
        onStartupOutputTruncated();
      }
      return;
    }
    startupLine = Buffer.from(incompleteLine);
  };
}
