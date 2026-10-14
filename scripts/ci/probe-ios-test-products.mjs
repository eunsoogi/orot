import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyIosTestProducts } from './ios-test-products.mjs';
import { fileDigest } from './ios-test-product-integrity.mjs';

const [profile, original, archiveDigest, manifestDigest, output] = process.argv.slice(2);
if (process.env.GITHUB_ACTIONS !== 'true' || !output || existsSync(output))
  throw new Error('Hosted rejection observations require a new owned evidence directory');
if (
  (await fileDigest(join(original, 'manifest.json'))) !== manifestDigest ||
  (await fileDigest(join(original, 'ios-test-products.tar'))) !== archiveDigest
)
  throw new Error('Rejection observations require the genuine downloaded producer artifact');
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const variants = [
  { name: 'missing-archive', expected: /ENOENT/ },
  { name: 'stale-attempt', expected: /provenance mismatch/ },
  { name: 'stale-source', expected: /provenance mismatch/ },
  { name: 'incompatible-configuration', expected: /provenance mismatch/ },
  { name: 'tampered-manifest', expected: /manifest digest mismatch/ },
  { name: 'tampered-archive', expected: /archive digest mismatch/ },
];
const observations = [];
for (const variant of variants) {
  const started = Date.now();
  const sandbox = join(directory, variant.name);
  mkdirSync(sandbox);
  const manifestPath = join(sandbox, 'manifest.json');
  cpSync(join(original, 'manifest.json'), manifestPath);
  if (variant.name !== 'missing-archive')
    cpSync(join(original, 'ios-test-products.tar'), join(sandbox, 'ios-test-products.tar'));
  let expectedManifest = manifestDigest;
  try {
    if (['stale-attempt', 'stale-source', 'incompatible-configuration'].includes(variant.name)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (variant.name === 'stale-attempt') manifest.context.attempt += 1;
      if (variant.name === 'stale-source')
        manifest.context.sourceSha =
          (manifest.context.sourceSha[0] === 'f' ? '0' : 'f') + manifest.context.sourceSha.slice(1);
      if (variant.name === 'incompatible-configuration')
        manifest.context.spec.configuration =
          manifest.context.spec.configuration === 'Release' ? 'Debug' : 'Release';
      writeFileSync(manifestPath, JSON.stringify(manifest));
      // Keep the digest valid to observe semantic provenance rejection independently of corruption.
      expectedManifest = await fileDigest(manifestPath);
    }
    if (variant.name === 'tampered-manifest') appendFileSync(manifestPath, '\n');
    if (variant.name === 'tampered-archive')
      appendFileSync(join(sandbox, 'ios-test-products.tar'), 'intentional-rejection-observation');
    let rejection;
    try {
      await verifyIosTestProducts(profile, sandbox, archiveDigest, expectedManifest);
    } catch (error) {
      if (!variant.expected.test(String(error))) throw error;
      rejection = String(error);
    }
    if (!rejection || existsSync(join(sandbox, 'verified-products')))
      throw new Error('An invalid native artifact was accepted or installed');
    observations.push({
      variant: variant.name,
      rejected: true,
      reason: rejection,
      elapsedMs: Date.now() - started,
    });
  } finally {
    // Only this newly created, private copy is removed. Genuine products and simulator state are untouched.
    rmSync(sandbox, { recursive: true, force: true });
  }
}
writeFileSync(
  join(directory, 'results.json'),
  JSON.stringify(
    {
      sourceSha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      profile,
      observations,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Hosted native artifact rejections observed: ${observations.length}`);
