import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localModelTests } from './ios-test-inventory.mjs';

const expectedModes = ['fresh', 'restart', 'indexed', 'reopened'];

/** Each corpus begins in a fresh owned container; its second phase must read that same container from a different app process. */
export async function executeLocalModelPhases(operations) {
  const results = [];
  for (const [index, identifier] of localModelTests.entries()) {
    if (index % 2 === 0) await operations.reset();
    const result = await operations.run(identifier);
    const pid = result?.hostProcessIdentifier;
    if (!Number.isSafeInteger(pid) || pid <= 0 || result?.result?.mode !== expectedModes[index])
      throw new Error(
        'Local model phase requires its actual app process and expected integration result mode',
      );
    if (index % 2 === 1 && pid === results[index - 1].hostProcessIdentifier)
      throw new Error('Local model persistence requires an actual app process restart');
    results.push(result);
  }
  return results;
}

/** Read only the exact test's JSON receipt from the owned destination; unrelated or duplicate attachments are rejected. */
export function readLocalModelAttachment(directory, identifier, udid) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const name = identifier.split('/').slice(1).join('/') + '()';
  const attachments = manifest
    .filter((entry) => entry.testIdentifier === name)
    .flatMap((entry) => entry.attachments)
    .filter((attachment) =>
      attachment.suggestedHumanReadableName?.startsWith('local-model-observed-result_'),
    );
  if (attachments.length !== 1 || attachments[0].deviceId !== udid)
    throw new Error('Missing, duplicate or foreign local model result attachment');
  const filename = attachments[0].exportedFileName;
  if (!/^[a-f0-9-]{36}\.json$/i.test(filename))
    throw new Error('Unexpected local model attachment path');
  return JSON.parse(readFileSync(join(directory, filename), 'utf8'));
}
