import { execFileSync } from 'node:child_process';
import { iosPreparationFailure } from './ios-test-preparation-diagnostics.mjs';

const maxHostLogBytes = 256 * 1024;
const maxHostLogEvents = 64;
const hostLogLookbackMs = 60_000;

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

/** Read only privacy-redacted CoreSimulatorService events for one verified UDID and one minute. */
export function collectBackupHostLifecycle({ udid, observedAt, runCommand = execFileSync }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(udid ?? ''))
    return unavailable('invalid-owned-udid');
  const endMs = Date.parse(observedAt ?? '');
  if (!Number.isFinite(endMs)) return unavailable('invalid-observation-time');
  const end = new Date(endMs).toISOString();
  const start = new Date(endMs - hostLogLookbackMs).toISOString();
  const predicate = `(process == "CoreSimulatorService" OR process == "com.apple.CoreSimulator.CoreSimulatorService") AND eventMessage CONTAINS[c] "${udid}"`;
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
      const message = typeof event.eventMessage === 'string' ? event.eventMessage : '';
      if (
        !message.toLowerCase().includes(udid.toLowerCase()) ||
        !['CoreSimulatorService', 'com.apple.CoreSimulator.CoreSimulatorService'].includes(
          event.process,
        )
      ) {
        unscopedRecords += 1;
        continue;
      }
      matchedRecords += 1;
      if (events.length < maxHostLogEvents)
        events.push({
          timestamp: typeof event.timestamp === 'string' ? event.timestamp.slice(0, 48) : null,
          process: event.process,
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
