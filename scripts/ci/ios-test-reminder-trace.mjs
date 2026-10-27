import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const maximumBytes = 64 * 1024;
const requiredFields = ['callSequence', 'monotonicNanoseconds', 'processID', 'runID', 'stage'];
const allowedFields = new Set([
  ...requiredFields,
  'authorization',
  'operationSequence',
  'errorCode',
  'errorDomain',
  'nullPlan',
  'ownErrorCase',
]);
const stages = new Set([
  'diagnostic-ready',
  'bridge-enter',
  'bridge-resolve',
  'bridge-reject',
  'selection-write-enter',
  'selection-write-resolve',
  'selection-write-reject',
  'request-authorization-enter',
  'request-authorization-resolve',
  'request-authorization-reject',
  'permission-request-enter',
  'permission-request-resolve',
  'permission-request-reject',
  'authorization-observed',
  'plan-validation-enter',
  'plan-validation-resolve',
  'plan-validation-reject',
  'expiry-check',
  'expiry-reject',
  'authorization-check',
  'authorization-reject',
  'trigger-check',
  'trigger-resolve',
  'trigger-reject',
  'center-add-enter',
  'center-add-resolve',
  'center-add-reject',
  'cancel',
]);
const authorizationStates = new Set(['authorized', 'notDetermined', 'denied', 'unknown']);
const ownErrorCases = new Set(['invalidInput', 'permissionDenied', 'expired', 'other']);
const errorDomains = new Set([
  'UNErrorDomain',
  'NSCocoaErrorDomain',
  'NSPOSIXErrorDomain',
  'NSURLErrorDomain',
  'other',
]);

/** Validate the complete bounded trace before it leaves the owned app container. */
export function validateReminderDiagnosticTrace(input, expectedRunID) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(expectedRunID) ||
    bytes.length === 0 ||
    bytes.length > maximumBytes
  )
    throw new Error('Reminder diagnostic run identity or trace size is invalid');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || !text.endsWith('\n'))
    throw new Error('Reminder diagnostic trace is not complete UTF-8 JSONL');
  const previous = new Map();
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => !line))
    throw new Error('Reminder diagnostic trace contains an empty record');
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('Reminder diagnostic trace contains invalid JSON');
    }
    const keys = Object.keys(event).sort();
    const canonical = JSON.stringify(Object.fromEntries(keys.map((key) => [key, event[key]])));
    if (
      canonical !== line ||
      keys.some((key) => !allowedFields.has(key)) ||
      requiredFields.some((key) => !Object.hasOwn(event, key)) ||
      event.runID !== expectedRunID.toLowerCase() ||
      !Number.isSafeInteger(event.processID) ||
      event.processID <= 0 ||
      !Number.isSafeInteger(event.callSequence) ||
      event.callSequence < 1 ||
      typeof event.monotonicNanoseconds !== 'string' ||
      !/^\d+$/.test(event.monotonicNanoseconds) ||
      !stages.has(event.stage)
    )
      throw new Error('Reminder diagnostic trace violates its fixed event schema');
    if (
      Object.hasOwn(event, 'operationSequence') &&
      (!Number.isSafeInteger(event.operationSequence) || event.operationSequence < 1)
    )
      throw new Error('Reminder diagnostic invocation identity is invalid');
    if (Object.hasOwn(event, 'nullPlan') && typeof event.nullPlan !== 'boolean')
      throw new Error('Reminder diagnostic trace has an invalid null-plan value');
    if (Object.hasOwn(event, 'authorization') && !authorizationStates.has(event.authorization))
      throw new Error('Reminder diagnostic trace has an invalid authorization value');
    const hasError = ['ownErrorCase', 'errorDomain', 'errorCode'].some((key) =>
      Object.hasOwn(event, key),
    );
    if (
      hasError !== event.stage.endsWith('-reject') ||
      (hasError &&
        (!ownErrorCases.has(event.ownErrorCase) ||
          !errorDomains.has(event.errorDomain) ||
          !Number.isSafeInteger(event.errorCode)))
    )
      throw new Error('Reminder diagnostic trace has an invalid allowlisted error');
    const prior = previous.get(event.processID);
    const time = BigInt(event.monotonicNanoseconds);
    if (event.callSequence !== (prior?.sequence ?? 0) + 1 || (prior && time <= prior.time))
      throw new Error('Reminder diagnostic trace sequence is discontinuous');
    previous.set(event.processID, { sequence: event.callSequence, time });
  }
  return { bytes: bytes.length, events: lines.length };
}

/** Copy validated bytes once; exclusive creation preserves any unexpected prior artifact. */
export function copyValidatedReminderDiagnosticTrace(sourcePath, targetPath, runID) {
  if (existsSync(targetPath))
    throw new Error('Reminder diagnostic capture destination already exists');
  if (statSync(sourcePath).size > maximumBytes)
    throw new Error('Reminder diagnostic source exceeds the bounded trace size');
  const bytes = readFileSync(sourcePath);
  const receipt = validateReminderDiagnosticTrace(bytes, runID);
  writeFileSync(targetPath, bytes, { flag: 'wx' });
  return receipt;
}
