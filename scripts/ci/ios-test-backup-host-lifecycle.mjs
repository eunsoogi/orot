import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { iosPreparationFailure } from './ios-test-preparation-diagnostics.mjs';

const maxHostLogBytes = 256 * 1024;
const maxHostLogEvents = 64;
const hostLogLookbackMs = 60_000;
const allowedSimulatorProcessNames = new Set([
  'CoreSimulatorService',
  'com.apple.CoreSimulator.CoreSimulatorService',
]);
const simulatorProcessPredicate = [...allowedSimulatorProcessNames]
  .map((process) => `process == "${process}"`)
  .join(' OR ');

function unavailable(reason) {
  return { status: 'unavailable', reason, privacy: 'platform-default-redaction' };
}

function failureReason(error) {
  if (error?.code === 'ETIMEDOUT') return 'timeout';
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'output-limit';
  return 'command-failed';
}

function redactHostMessage(value, udid) {
  const uuid = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
  return value
    .replace(uuid, (candidate) =>
      candidate.toLowerCase() === udid.toLowerCase() ? candidate : '[other-udid]',
    )
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
    .slice(0, 1024);
}

function formatUtcLogTimestamp(timestampMs) {
  // `log show` accepts second-resolution UTC dates, not JavaScript ISO strings.
  return new Date(timestampMs)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '+0000');
}

function simulatorProcess(event) {
  if (allowedSimulatorProcessNames.has(event.process)) return event.process;
  // Native ndjson may report the process label or executable basename; keep both checks exact.
  const imageName = basename(event.processImagePath ?? '');
  return allowedSimulatorProcessNames.has(imageName) ? imageName : null;
}

// NDJSON appends a count/finished object; it reports stream completion, not a log event.
function isCompletionRecord(event) {
  return (
    event &&
    typeof event === 'object' &&
    !Array.isArray(event) &&
    Object.keys(event).length === 2 &&
    Number.isInteger(event.count) &&
    event.count >= 0 &&
    event.finished === 1
  );
}

/** Read only privacy-redacted CoreSimulatorService events for one verified UDID and one minute. */
export function collectBackupHostLifecycle({ udid, observedAt, runCommand = execFileSync }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(udid ?? ''))
    return unavailable('invalid-owned-udid');
  const endMs = Date.parse(observedAt ?? '');
  if (!Number.isFinite(endMs)) return unavailable('invalid-observation-time');
  const end = formatUtcLogTimestamp(endMs);
  const start = formatUtcLogTimestamp(endMs - hostLogLookbackMs);
  const predicate = `(${simulatorProcessPredicate}) AND eventMessage CONTAINS[c] "${udid}"`;
  let output;
  try {
    output = runCommand(
      '/usr/bin/log',
      [
        'show',
        '--start',
        start,
        '--end',
        end,
        '--style',
        'ndjson',
        '--info',
        '--predicate',
        predicate,
      ],
      { encoding: 'utf8', timeout: 3000, maxBuffer: maxHostLogBytes },
    );
  } catch (error) {
    return {
      ...unavailable(failureReason(error)),
      commandOutcome: iosPreparationFailure(error),
    };
  }
  if (!String(output).trim())
    return { status: 'empty', start, end, events: [], privacy: 'platform-default-redaction' };
  const events = [];
  let unscopedRecords = 0;
  let matchedRecords = 0;
  try {
    for (const line of String(output).split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      if (isCompletionRecord(event)) continue;
      const message = typeof event.eventMessage === 'string' ? event.eventMessage : '';
      const process = simulatorProcess(event);
      if (!message.toLowerCase().includes(udid.toLowerCase()) || !process) {
        unscopedRecords += 1;
        continue;
      }
      matchedRecords += 1;
      if (events.length < maxHostLogEvents)
        events.push({
          timestamp: typeof event.timestamp === 'string' ? event.timestamp.slice(0, 48) : null,
          process,
          subsystem: typeof event.subsystem === 'string' ? event.subsystem.slice(0, 128) : null,
          category: typeof event.category === 'string' ? event.category.slice(0, 128) : null,
          eventMessage: redactHostMessage(message, udid),
        });
    }
  } catch {
    return unavailable('invalid-log-format');
  }
  if (unscopedRecords && !events.length) return unavailable('unscoped-log-records');
  return {
    status: events.length ? 'captured' : 'empty',
    start,
    end,
    maxBytes: maxHostLogBytes,
    maxEvents: maxHostLogEvents,
    filteredOutOfScopeRecords: unscopedRecords,
    truncated: matchedRecords > maxHostLogEvents,
    omittedEvents: Math.max(0, matchedRecords - maxHostLogEvents),
    events,
    privacy: 'platform-default-redaction',
  };
}
