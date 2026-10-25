import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOAuthProducts, verifyOAuthProducts } from '../oauth-test-products.mjs';
import { fileDigest } from '../ios-test-product-integrity.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'orot-oauth-artifact-'));
  const source = join(root, 'source');
  const bundle = join(source, 'OpenAIProviderTests.xctest');
  const binary = join(bundle, 'Contents/MacOS/OpenAIProviderTests');
  const resource = join(
    bundle,
    'Contents/Resources/OpenAIProvider_OpenAIProviderTests.bundle/Contents/Resources/identity-tokens.json',
  );
  mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true });
  mkdirSync(
    join(bundle, 'Contents/Resources/OpenAIProvider_OpenAIProviderTests.bundle/Contents/Resources'),
    { recursive: true },
  );
  writeFileSync(binary, 'synthetic binary');
  writeFileSync(resource, '{}');
  const inventory = join(root, 'inventory.txt');
  writeFileSync(inventory, 'OpenAIProviderTests.TokenTests/testLogin\n');
  const harness = join(root, 'harness');
  writeFileSync(harness, 'synthetic harness');
  // Only the architecture inspection is simulated; real tar serialization, header checks and hashes run below.
  writeFileSync(
    join(root, 'xcrun'),
    `#!${process.execPath}\nif(process.argv[2] !== 'lipo')process.exit(99);console.log('arm64');\n`,
    { mode: 0o755 },
  );
  const oldPath = process.env.PATH;
  process.env.PATH = root + ':' + oldPath;
  t.after(() => {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  });
  const context = {
    sourceSha: 'a'.repeat(40),
    runId: '123',
    attempt: '1',
    profile: 'oauth-macos',
    configuration: 'Debug',
    inputDigest: 'b'.repeat(64),
    toolchain: { xcode: 'synthetic toolchain' },
  };
  return { root, source, resource, inventory, harness, context, directory: join(root, 'artifact') };
}

test('portable OAuth products retain the fixture resources after their original build is removed', async (t) => {
  const f = fixture(t);
  const created = await createOAuthProducts(
    f.source,
    f.inventory,
    f.harness,
    f.directory,
    f.context,
  );
  rmSync(f.source, { recursive: true });
  const product = await verifyOAuthProducts(
    f.directory,
    created.archiveDigest,
    created.manifestDigest,
    f.context,
  );
  assert.deepEqual(product.tests, ['OpenAIProviderTests.TokenTests/testLogin']);
  assert.equal(product.harnessBinaryDigest, await fileDigest(f.harness));
  assert.equal(
    readFileSync(join(product.bundle, 'Contents/MacOS/OpenAIProviderTests'), 'utf8'),
    'synthetic binary',
  );
});

test('wrong run, toolchain, producer hashes and changed archives fail before executing a bundle', async (t) => {
  const f = fixture(t);
  const created = await createOAuthProducts(
    f.source,
    f.inventory,
    f.harness,
    f.directory,
    f.context,
  );
  for (const key of ['sourceSha', 'runId', 'attempt', 'inputDigest', 'toolchain'])
    await assert.rejects(
      verifyOAuthProducts(f.directory, created.archiveDigest, created.manifestDigest, {
        ...f.context,
        [key]: 'wrong',
      }),
      /provenance/,
    );
  await assert.rejects(
    verifyOAuthProducts(f.directory, '', created.manifestDigest, f.context),
    /digests/,
  );
  await assert.rejects(
    verifyOAuthProducts(f.directory, created.archiveDigest, 'c'.repeat(64), f.context),
    /manifest digest/,
  );
  const archive = join(f.directory, 'oauth-tests.tar');
  writeFileSync(archive, 'tampered');
  await assert.rejects(
    verifyOAuthProducts(f.directory, created.archiveDigest, created.manifestDigest, f.context),
    /archive digest/,
  );
});

test('missing fixtures, repeated discovery and unsafe tar entries cannot become executable products', async (t) => {
  const f = fixture(t);
  writeFileSync(
    f.inventory,
    'OpenAIProviderTests.TokenTests/testLogin\nOpenAIProviderTests.TokenTests/testLogin\n',
  );
  await assert.rejects(
    createOAuthProducts(f.source, f.inventory, f.harness, join(f.root, 'duplicate'), f.context),
    /unique/,
  );
  writeFileSync(f.inventory, 'OpenAIProviderTests.TokenTests/testLogin\n');
  const created = await createOAuthProducts(
    f.source,
    f.inventory,
    f.harness,
    f.directory,
    f.context,
  );
  rmSync(f.resource);
  await assert.rejects(
    createOAuthProducts(f.source, f.inventory, f.harness, join(f.root, 'missing'), f.context),
    /fixtures/,
  );
  const archive = join(f.directory, 'oauth-tests.tar');
  execFileSync('python3', [
    '-c',
    'import tarfile,sys\nwith tarfile.open(sys.argv[1],"w") as a:\n t=tarfile.TarInfo("../escape");a.addfile(t)',
    archive,
  ]);
  const manifestPath = join(f.directory, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.archiveDigest = await fileDigest(archive);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  await assert.rejects(
    verifyOAuthProducts(
      f.directory,
      manifest.archiveDigest,
      await fileDigest(manifestPath),
      f.context,
    ),
    /Unsafe/,
  );
  assert.ok(created.manifestDigest);
});
