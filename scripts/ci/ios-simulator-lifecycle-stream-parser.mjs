const maxStartupOutputChars = 4096;

/** Gate record capture on the initialized compact log stream and discard its startup text. */
export function createIosSimulatorLifecycleStreamParser({
  onEvents,
  onReady,
  onStartupOutputTruncated,
}) {
  let startupOutput = '';
  let streamReady = false;
  return (chunk) => {
    if (streamReady) {
      onEvents(chunk);
      return;
    }
    startupOutput += Buffer.from(chunk).toString('utf8');
    const lines = startupOutput.split('\n');
    const headerIndex = lines.findIndex((line) =>
      /^Timestamp\s+Ty Process\[PID:TID\]/.test(line.replace(/\r$/, '')),
    );
    if (headerIndex < 0 || headerIndex === lines.length - 1) {
      if (startupOutput.length > maxStartupOutputChars) {
        startupOutput = startupOutput.slice(-maxStartupOutputChars);
        onStartupOutputTruncated();
      }
      return;
    }
    streamReady = true;
    onReady();
    const eventText = lines.slice(headerIndex + 1).join('\n');
    if (eventText) onEvents(Buffer.from(eventText));
    startupOutput = '';
  };
}
