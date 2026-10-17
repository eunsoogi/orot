import { appendFileSync } from 'node:fs';

/** Keep public process outcomes without command output, host paths or arbitrary exception text. */
export function iosPreparationFailure(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : null,
    signal: /^SIG[A-Z0-9]{1,16}$/.test(error?.signal ?? '') ? error.signal : null,
    errorCode: /^[A-Z][A-Z0-9_]{0,31}$/.test(error?.code ?? '') ? error.code : null,
  };
}

/** Existing always-uploaded logs are the fallback when the optional sidecar cannot be written. */
export function recordIosPreparationDiagnostic(record, path) {
  const entry = { timestamp: new Date().toISOString(), ...record };
  console.error('IOS_PREPARATION_DIAGNOSTIC ' + JSON.stringify(entry));
  if (!path) return;
  try {
    appendFileSync(path, JSON.stringify(entry) + '\n');
  } catch (error) {
    console.error(
      'IOS_PREPARATION_DIAGNOSTIC ' +
        JSON.stringify({
          event: 'diagnostic-write-failed',
          ...iosPreparationFailure(error),
        }),
    );
  }
}

function publicString(value) {
  return typeof value === 'string' && value.length <= 160 ? value : null;
}

/** Xcode 27.0 simctl help/list reports `pairs` as an object. Only the empty shape is observed locally;
 * nonempty entries have no verified member contract and must remain unknown, never inferred as no pairs.
 * Project the owned device and selected runtime only; omit foreign names, paths and arbitrary fields. */
export function iosPreparationInventory(owner, snapshot, device, runtime) {
  const pairs = snapshot.pairs;
  const isObject = pairs !== null && typeof pairs === 'object' && !Array.isArray(pairs);
  const entryCount = isObject ? Object.keys(pairs).length : null;
  return {
    event: 'pre-boot-inventory',
    device: {
      udid: publicString(owner.udid),
      deviceTypeIdentifier: publicString(device.deviceTypeIdentifier),
      state: publicString(device.state),
      isAvailable: typeof device.isAvailable === 'boolean' ? device.isAvailable : null,
    },
    runtime: {
      identifier: publicString(runtime.identifier),
      buildversion: publicString(runtime.buildversion),
      isAvailable: runtime.isAvailable === true,
    },
    pairs: {
      status: entryCount === 0 ? 'observed-empty' : 'unknown-schema',
      entryCount,
    },
  };
}
