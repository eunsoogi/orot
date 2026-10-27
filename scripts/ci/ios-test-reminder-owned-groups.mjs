import { fstatSync, writeSync } from 'node:fs';
import { readProcessSnapshotAsync } from './ios-test-owned-process-supervisor.mjs';

const bindingKeys = ['runID', 'sourceSHA', 'selector', 'udid'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fields = new Set([...bindingKeys, 'phase', 'attemptSequence', 'pid', 'group', 'identity']);

function validBinding(binding) {
  return (
    uuid.test(binding?.runID ?? '') &&
    /^[a-f0-9]{40}$/i.test(binding?.sourceSHA ?? '') &&
    typeof binding?.selector === 'string' &&
    binding.selector.length > 0 &&
    uuid.test(binding?.udid ?? '')
  );
}

/** The admitted fixture root alone writes its inherited descriptor; names, stdout and PID files are never ownership evidence. */
export function createReminderOwnedGroupObserver(
  binding,
  { write, snapshot = readProcessSnapshotAsync } = {},
) {
  if (!validBinding(binding)) throw new Error('Owned reminder group binding is invalid');
  if (!write) {
    const descriptor = fstatSync(3);
    if (!descriptor.isFIFO() && !descriptor.isSocket())
      throw new Error('Inherited owned-group pipe is unavailable');
    write = (data) => writeSync(3, data);
  }
  let sequence = 0;
  const emit = (event) => write(JSON.stringify({ ...binding, ...event }) + '\n');
  return async ({ phase, child }) => {
    if (!['attempt', 'spawned'].includes(phase)) throw new Error('Invalid group creation phase');
    if (phase === 'attempt') {
      sequence += 1;
      emit({ phase, attemptSequence: sequence });
      return;
    }
    try {
      const row = (await snapshot()).find((item) => item.pid === child.pid);
      if (!row || row.group !== child.pid || row.identity.length !== 24)
        throw new Error('Owned group creation identity is incomplete');
      emit({
        phase: 'spawned',
        attemptSequence: sequence,
        pid: row.pid,
        group: row.group,
        identity: row.identity,
      });
    } catch (error) {
      emit({ phase: 'failed', attemptSequence: sequence });
      throw error;
    }
  };
}

/** A bounded, exact-binding frame registers only the canonical attempt; diagnostics retain fixed reasons and lengths, never frame contents. */
export function consumeReminderOwnedGroupPipe(stream, binding, supervisor) {
  let input = '';
  let bytes = 0;
  let invalid = !validBinding(binding);
  const invalidate = (reason = 'invalid-registration-frame') => {
    invalid = true;
    supervisor.markUncertain(reason, {
      receivedLength: bytes,
      bufferedFrameLength: Buffer.byteLength(input),
    });
  };
  return new Promise((resolve) => {
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (invalid || bytes > 8192) {
        invalidate(invalid ? 'registration-binding-invalid' : 'registration-pipe-limit-exceeded');
        return;
      }
      input += chunk.toString('utf8');
      let newline;
      while ((newline = input.indexOf('\n')) >= 0) {
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        let reason = 'malformed-registration-frame';
        try {
          if (!line) {
            reason = 'empty-registration-frame';
            throw new Error('Invalid registration frame');
          }
          if (Buffer.byteLength(line) > 2048) {
            reason = 'registration-frame-limit-exceeded';
            throw new Error('Invalid registration frame');
          }
          const event = JSON.parse(line);
          if (Object.keys(event).some((key) => !fields.has(key))) {
            reason = 'unsupported-registration-field';
            throw new Error('Mismatched registration');
          }
          if (bindingKeys.some((key) => event[key] !== binding[key])) {
            reason = 'registration-binding-mismatch';
            throw new Error('Mismatched registration');
          }
          if (!['attempt', 'spawned', 'failed'].includes(event.phase)) {
            reason = 'unsupported-registration-phase';
            throw new Error('Mismatched registration');
          }
          if (
            event.phase !== 'spawned' &&
            ['pid', 'group', 'identity'].some((key) => Object.hasOwn(event, key))
          ) {
            reason = 'identity-field-on-nonspawn-event';
            throw new Error('Mismatched registration');
          }
          supervisor.registration(event);
        } catch {
          invalidate(reason);
        }
      }
    });
    stream.once('error', () => invalidate('registration-pipe-error'));
    stream.once('close', () => {
      if (input.length) invalidate('registration-frame-incomplete-at-close');
      else if (invalid) invalidate('registration-binding-invalid');
      supervisor.closeRegistrations(invalid || input.length > 0);
      resolve();
    });
  });
}
