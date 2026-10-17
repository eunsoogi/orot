import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { checkArchiveNames, fileDigest, productDigest } from './ios-test-product-integrity.mjs';
import { oauthTestContext, oauthTestEnvironment } from './oauth-test-context.mjs';
import {
  oauthDiscoveredTests,
  verifyOAuthReceipt,
  verifyOAuthTestOutput,
} from './oauth-test-results.mjs';

function inspectBundle(products) {
  const names = readdirSync(products);
  if (names.length !== 1 || names[0] !== 'OpenAIProviderTests.xctest')
    throw new Error('OAuth products require exactly the package XCTest bundle');
  const bundle = join(products, names[0]);
  const binary = join(bundle, 'Contents/MacOS/OpenAIProviderTests');
  const resources = join(
    bundle,
    'Contents/Resources/OpenAIProvider_OpenAIProviderTests.bundle/Contents/Resources/identity-tokens.json',
  );
  if (!existsSync(binary) || !existsSync(resources))
    throw new Error('OAuth executable or bundled fixtures are missing');
  if (
    !execFileSync('xcrun', ['lipo', '-archs', binary], { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .includes('arm64')
  )
    throw new Error('OAuth test executable architecture mismatch');
  return bundle;
}

/** Transfer only the runnable signed bundle, its embedded resources and authenticated build facts. */
export async function createOAuthProducts(
  source,
  inventory,
  harness,
  directory,
  context = oauthTestContext(),
) {
  if (existsSync(directory)) throw new Error('Refusing to replace an OAuth artifact');
  mkdirSync(directory, { recursive: true });
  const products = join(directory, 'products');
  mkdirSync(products);
  cpSync(join(source, 'OpenAIProviderTests.xctest'), join(products, 'OpenAIProviderTests.xctest'), {
    recursive: true,
    dereference: false,
  });
  inspectBundle(products);
  const manifest = {
    schemaVersion: 1,
    context,
    tests: oauthDiscoveredTests(readFileSync(inventory, 'utf8')),
    harnessBinaryDigest: await fileDigest(harness),
    treeDigest: await productDigest(products),
  };
  const archive = join(directory, 'oauth-tests.tar');
  execFileSync('tar', ['-cf', archive, '-C', directory, 'products'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  manifest.archiveDigest = await fileDigest(archive);
  const path = join(directory, 'manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  const manifestDigest = await fileDigest(path);
  rmSync(products, { recursive: true });
  return { ...manifest, manifestDigest };
}

/** Verify source, run, toolchain, both producer digests and every tar entry before loading executable code. */
export async function verifyOAuthProducts(
  directory,
  archiveDigest,
  manifestDigest,
  context = oauthTestContext(),
) {
  if (![archiveDigest, manifestDigest].every((value) => /^[a-f0-9]{64}$/.test(value ?? '')))
    throw new Error('OAuth producer digests are required');
  const path = join(directory, 'manifest.json');
  const archive = join(directory, 'oauth-tests.tar');
  if ((await fileDigest(path)) !== manifestDigest)
    throw new Error('OAuth manifest digest mismatch');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.schemaVersion !== 1 || !isDeepStrictEqual(manifest.context, context))
    throw new Error('OAuth product provenance mismatch');
  if (manifest.archiveDigest !== archiveDigest || (await fileDigest(archive)) !== archiveDigest)
    throw new Error('OAuth archive digest mismatch');
  oauthDiscoveredTests(manifest.tests.join('\n'));
  checkArchiveNames(execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }));
  execFileSync(process.execPath, [
    fileURLToPath(new URL('./verify-ios-test-archive.mjs', import.meta.url)),
    archive,
  ]);
  const staging = mkdtempSync(join(directory, '.verified-'));
  try {
    execFileSync('tar', ['-xf', archive, '-C', staging]);
    const products = join(staging, 'products');
    if ((await productDigest(products)) !== manifest.treeDigest)
      throw new Error('OAuth product integrity mismatch');
    const bundle = inspectBundle(products);
    return { ...manifest, manifestDigest, bundle, staging };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory, first, second, third, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Unexpected OAuth product arguments');
  if (command === 'create') {
    const result = await createOAuthProducts(first, second, third, directory);
    if (!process.env.GITHUB_OUTPUT) throw new Error('OAuth producer requires workflow outputs');
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `archive_digest=${result.archiveDigest}\nmanifest_digest=${result.manifestDigest}\n`,
      { flag: 'a' },
    );
  } else if (command === 'execute') {
    const product = await verifyOAuthProducts(directory, first, second);
    try {
      const result = spawnSync('xcrun', ['xctest', product.bundle], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: oauthTestEnvironment(),
      });
      const log = (result.stdout ?? '') + (result.stderr ?? '');
      writeFileSync(join(directory, 'tests.log'), log);
      process.stdout.write(log);
      if (result.status !== 0 || result.signal || result.error)
        throw new Error('OAuth XCTest execution failed');
      const tests = verifyOAuthTestOutput(log, product.tests);
      const receipt = verifyOAuthReceipt(
        {
          schemaVersion: 1,
          passed: true,
          context: product.context,
          tests,
          archiveDigest: product.archiveDigest,
          manifestDigest: product.manifestDigest,
          harnessBinaryDigest: product.harnessBinaryDigest,
        },
        process.env,
      );
      writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    } finally {
      rmSync(product.staging, { recursive: true, force: true });
    }
  } else
    throw new Error(
      'Usage: oauth-test-products.mjs create <artifact> <built-products> <inventory> <harness-binary> | execute <artifact> <archive-digest> <manifest-digest>',
    );
}
