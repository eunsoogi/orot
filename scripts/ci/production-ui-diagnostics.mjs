import { execFileSync } from 'node:child_process';

const events = new Set([
  'sdk_tools_registered',
  'sdk_callback_entered',
  'sdk_callback_returned',
  'sdk_generation_completed',
  'sdk_generation_failed',
  'generation_cancelled',
]);
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Keep only typed lifecycle fields; never retain raw system log messages or model content. */
export function sanitizedTrace(lines) {
  const result = [];
  for (const line of lines.split('\n')) {
    try {
      const message = JSON.parse(line).eventMessage;
      const marker = '[OROT_NATIVE_TOOL] ';
      if (typeof message !== 'string' || !message.includes(marker)) continue;
      const value = JSON.parse(message.slice(message.indexOf(marker) + marker.length));
      if (
        !events.has(value.event) ||
        !safeId(value.requestId) ||
        !safeId(value.bridgeCallId) ||
        value.identityOrigin !== 'bridge' ||
        value.sdkCallId !== 'unavailable'
      )
        continue;
      const event = {
        event: value.event,
        requestId: value.requestId,
        bridgeCallId: value.bridgeCallId,
        identityOrigin: 'bridge',
        sdkCallId: 'unavailable',
      };
      if (Number.isSafeInteger(value.bytes) && value.bytes >= 0) event.bytes = value.bytes;
      result.push(event);
    } catch {
      // Incomplete or redacted log entries cannot become positive SDK evidence.
    }
  }
  return result;
}

/** A missing or unparseable trace is unknown; bridge identifiers are not SDK call identifiers. */
export function readProductionTrace(udid, started) {
  const utc = started.toISOString().slice(0, 19).replace('T', ' ') + '+0000';
  try {
    const lines = execFileSync(
      'xcrun',
      [
        'simctl',
        'spawn',
        udid,
        'log',
        'show',
        '--style',
        'ndjson',
        '--timezone',
        'UTC',
        '--start',
        utc,
        '--predicate',
        'process == "Orot" AND eventMessage CONTAINS "[OROT_NATIVE_TOOL]"',
      ],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = sanitizedTrace(lines);
    return { status: parsed.length ? 'observed' : 'unknown', events: parsed };
  } catch {
    return { status: 'unavailable', events: [] };
  }
}
