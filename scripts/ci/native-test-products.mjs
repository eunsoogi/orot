import { execFileSync } from 'node:child_process';
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
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { productContext } from './native-product-context.mjs';
import { checkArchiveNames, fileDigest, productDigest } from './native-product-integrity.mjs';

function testRunFile(products) {
  const files = readdirSync(products).filter((name) => name.endsWith('.xctestrun'));
  if (files.length !== 1) throw new Error('Exactly one native test-run file is required');
  return files[0];
}

function verifyTestRun(products, spec) {
  const name = testRunFile(products);
  const data = JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', join(products, name)], {
      encoding: 'utf8',
    }),
  );
  const targets =
    data.TestConfigurations?.flatMap((configuration) => configuration.TestTargets ?? []) ?? [];
  if (
    targets.length !== 2 ||
    !targets.some(
      (target) =>
        target.BlueprintName === spec.nativeTarget && target.IsAppHostedTestBundle === true,
    ) ||
    !targets.some(
      (target) => target.BlueprintName === spec.uiTarget && target.IsUITestBundle === true,
    )
  ) {
    throw new Error(
      'Native test-run file does not contain the required integration and UI targets',
    );
  }
  for (const target of targets) {
    for (const field of ['TestHostPath', 'TestBundlePath', 'UITargetAppPath']) {
      const value = target[field];
      if (value && (!/^__(TESTROOT|TESTHOST)__\//.test(value) || value.split('/').includes('..'))) {
        throw new Error('Native test-run product paths must be portable and confined');
      }
    }
  }
  const configuration = join(products, spec.configuration + '-iphonesimulator');
  for (const binary of [
    join(configuration, 'Orot.app', 'Orot'),
    join(configuration, 'Orot.app', 'PlugIns', spec.nativeTarget + '.xctest', spec.nativeTarget),
    join(
      configuration,
      spec.uiTarget + '-Runner.app',
      'PlugIns',
      spec.uiTarget + '.xctest',
      spec.uiTarget,
    ),
  ]) {
    const architectures = execFileSync('xcrun', ['lipo', '-archs', binary], { encoding: 'utf8' })
      .trim()
      .split(/\s+/);
    if (!architectures.includes(spec.architecture))
      throw new Error('Native test product architecture mismatch');
  }
  return name;
}

export async function createNativeProducts(
  profile,
  sourceProducts,
  artifactDirectory,
  env = process.env,
) {
  const context = productContext(process.cwd(), profile, env);
  const directory = resolve(artifactDirectory);
  if (existsSync(directory))
    throw new Error('Refusing to replace existing native product artifact');
  mkdirSync(directory, { recursive: true });
  const products = join(directory, 'products');
  const configuration = context.spec.configuration + '-iphonesimulator';
  mkdirSync(join(products, configuration), { recursive: true });
  const testRun = verifyTestRun(sourceProducts, context.spec);
  cpSync(join(sourceProducts, testRun), join(products, testRun));
  // Only runnable products are transferred; compiler intermediates and dependency checkouts are not consumers' inputs.
  for (const name of ['Orot.app', context.spec.uiTarget + '-Runner.app']) {
    cpSync(join(sourceProducts, configuration, name), join(products, configuration, name), {
      recursive: true,
      dereference: false,
    });
  }
  verifyTestRun(products, context.spec);
  const treeDigest = await productDigest(products);
  const archive = join(directory, 'native-products.tar');
  execFileSync('tar', ['-cf', archive, '-C', directory, 'products'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  const manifest = {
    schemaVersion: 1,
    context,
    testRun,
    treeDigest,
    archiveDigest: await fileDigest(archive),
  };
  const manifestPath = join(directory, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const manifestDigest = await fileDigest(manifestPath);
  if (env.GITHUB_OUTPUT) {
    writeFileSync(
      env.GITHUB_OUTPUT,
      `archive_digest=${manifest.archiveDigest}\nmanifest_digest=${manifestDigest}\n`,
      { flag: 'a' },
    );
  }
  rmSync(products, { recursive: true });
  return { ...manifest, manifestDigest };
}

export async function verifyNativeProducts(
  profile,
  artifactDirectory,
  expectedArchive,
  expectedManifest,
  env = process.env,
) {
  if (![expectedArchive, expectedManifest].every((value) => /^[a-f0-9]{64}$/.test(value ?? '')))
    throw new Error('Native producer digests are required');
  const context = productContext(process.cwd(), profile, env);
  const directory = resolve(artifactDirectory);
  const archive = join(directory, 'native-products.tar');
  const path = join(directory, 'manifest.json');
  if ((await fileDigest(path)) !== expectedManifest)
    throw new Error('Native product manifest digest mismatch');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.schemaVersion !== 1 || !isDeepStrictEqual(manifest.context, context))
    throw new Error('Native product provenance mismatch');
  if ((await fileDigest(archive)) !== expectedArchive || manifest.archiveDigest !== expectedArchive)
    throw new Error('Native product archive digest mismatch');
  checkArchiveNames(execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }));
  execFileSync(process.execPath, [
    fileURLToPath(new URL('./verify-native-archive.mjs', import.meta.url)),
    archive,
  ]);
  const staging = mkdtempSync(join(directory, '.verified-'));
  try {
    execFileSync('tar', ['-xf', archive, '-C', staging]);
    const products = join(staging, 'products');
    if ((await productDigest(products)) !== manifest.treeDigest)
      throw new Error('Native product integrity mismatch');
    const testRun = verifyTestRun(products, context.spec);
    if (testRun !== manifest.testRun) throw new Error('Native test-run identity mismatch');
    const destination = join(directory, 'verified-products');
    if (existsSync(destination)) throw new Error('Refusing to replace verified native products');
    cpSync(products, destination, { recursive: true, dereference: false });
    console.log(
      `NATIVE_PRODUCTS_VERIFIED profile=${profile} source=${context.sourceSha} tree=${manifest.treeDigest}`,
    );
    return join(destination, testRun);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, profile, directory, first, second] = process.argv.slice(2);
  if (command === 'create') await createNativeProducts(profile, directory, first);
  else if (command === 'verify') {
    const path = await verifyNativeProducts(profile, directory, first, second);
    if (process.env.GITHUB_OUTPUT)
      writeFileSync(process.env.GITHUB_OUTPUT, `test_run=${path}\n`, { flag: 'a' });
  } else
    throw new Error(
      'Usage: native-test-products.mjs <create|verify> <profile> <products|artifact-directory> <artifact-directory|archive-digest> [manifest-digest]',
    );
}
