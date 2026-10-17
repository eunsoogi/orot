import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backupTests } from './ios-test-inventory.mjs';

export function recordingIdentifier(result) {
  const identifier = result?.recording?.recordingId;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(identifier ?? ''))
    throw new Error('Backup result requires its actual synthetic recording UUID');
  return identifier.toLowerCase();
}

/** Select the attachment from its exact case and destination, not an unrelated JSON file. */
export function readBackupAttachment(directory, identifier, mode, udid) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const name = identifier.split('/').slice(1).join('/') + '()';
  const attachments = manifest
    .filter((entry) => entry.testIdentifier === name)
    .flatMap((entry) => entry.attachments)
    .filter((attachment) =>
      attachment.suggestedHumanReadableName?.startsWith(`backup-${mode}-observed-result_`),
    );
  if (attachments.length !== 1 || attachments[0].deviceId !== udid)
    throw new Error('Missing, duplicate or foreign backup result attachment');
  const filename = attachments[0].exportedFileName;
  if (!/^[a-f0-9-]{36}\.json$/i.test(filename))
    throw new Error('Unexpected backup attachment path');
  return JSON.parse(readFileSync(join(directory, filename), 'utf8'));
}

/** Each independent case starts fresh. Snapshot recovery continues only after actual seed and host restore succeed. */
export async function executeBackupPhases(operations) {
  // Independent cases share the common UI runner but retain a complete fresh container and Keychain before each body.
  const results = await operations.runIndependent(backupTests.slice(0, 3));
  if (!Array.isArray(results) || results.length !== 3)
    throw new Error('Missing independent backup results');
  await operations.reset({ preserveKeychain: false });
  const seeded = await operations.run(backupTests[3]);
  results.push(seeded);
  const recordingID = recordingIdentifier(seeded);
  const snapshot = await operations.snapshot(recordingID);
  try {
    await operations.reset({ preserveKeychain: true });
    await operations.restore(snapshot, recordingID);
    const recovered = await operations.run(backupTests[4], recordingID);
    if (recordingIdentifier(recovered) !== recordingID)
      throw new Error('Restored recording identity changed across app uninstall');
    results.push(recovered);
  } finally {
    await operations.cleanup(snapshot);
  }
  return results;
}
