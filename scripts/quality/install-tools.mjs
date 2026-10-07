import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveExtractionPlan, hasCompletePinnedAsset, pinnedArchiveEntries } from './archive.mjs';
import { parsePlatformArgument, selectQualityTools } from './platforms.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const versions = JSON.parse(
  await readFile(new URL('./tool-versions.json', import.meta.url), 'utf8'),
);
const cache = join(root, 'node_modules/.cache/orot-quality');
const platform = `${process.platform}-${process.arch}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr?.trim() || `${command} exited ${result.status}`);
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function assertVersion(command, expected, env = process.env) {
  const output = run(command, ['--version'], { env });
  if (!output.includes(expected))
    throw new Error(`${command} reports ${output}; expected ${expected}`);
}

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function ensureAsset(name, spec, runtimeEnv) {
  const destination = join(cache, spec.cachePath);
  const executable = join(destination, spec.binary);
  if (await hasCompletePinnedAsset(spec, destination)) {
    assertVersion(executable, spec.version, runtimeEnv);
    return executable;
  }

  // Remove only this tool's incomplete cache so a version directory can be atomically republished.
  await rm(destination, { recursive: true, force: true });
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(join(parent, '.install-'));
  try {
    const archive = join(temporary, basename(new URL(spec.url).pathname));
    run('curl', [
      '--fail',
      '--location',
      '--retry',
      '3',
      '--connect-timeout',
      '30',
      '--max-time',
      '300',
      spec.url,
      '--output',
      archive,
    ]);
    const actualHash = await sha256(archive);
    // Release asset hashes prevent a mutable download URL from silently changing tool bytes.
    if (actualHash !== spec.sha256)
      throw new Error(`${name} archive SHA-256 mismatch: ${actualHash}`);

    const extraction = archiveExtractionPlan(spec, archive, temporary);
    if (extraction) run(extraction.command, extraction.args);
    const source = extraction ? join(temporary, spec.binary) : archive;
    const relative = resolve(source);
    if (!relative.startsWith(`${temporary}${sep}`))
      throw new Error(`${name} archive path escapes its install directory`);
    await stat(source);
    const staging = join(temporary, 'installed');
    const stagedExecutable = join(staging, spec.binary);
    await mkdir(dirname(stagedExecutable), { recursive: true });
    const selectedEntries = pinnedArchiveEntries(spec);
    if (selectedEntries) {
      // Keep only the formatter and adjacent loader path from LLVM's full SDK archive.
      for (const entry of selectedEntries) {
        const extractedPath = resolve(temporary, entry);
        const stagedPath = resolve(staging, entry);
        if (
          !extractedPath.startsWith(`${temporary}${sep}`) ||
          !stagedPath.startsWith(`${staging}${sep}`)
        ) {
          throw new Error(`${name} pinned archive path escapes its install directory`);
        }
        await mkdir(dirname(stagedPath), { recursive: true });
        await copyFile(extractedPath, stagedPath);
      }
    } else {
      await copyFile(source, stagedExecutable);
    }
    await chmod(stagedExecutable, 0o755);
    assertVersion(stagedExecutable, spec.version, runtimeEnv);
    // Publish a version directory only after its binary reports the pinned release.
    await rename(staging, destination);
    return executable;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function ensureJdk(spec, runtimeEnv) {
  const home = join(cache, spec.cachePath);
  const java = join(home, 'bin/java');
  try {
    await stat(java);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(home);
    await mkdir(parent, { recursive: true });
    const temporary = await mkdtemp(join(parent, '.install-'));
    try {
      const archive = join(temporary, basename(new URL(spec.url).pathname));
      run('curl', [
        '--fail',
        '--location',
        '--retry',
        '3',
        '--connect-timeout',
        '30',
        '--max-time',
        '300',
        spec.url,
        '--output',
        archive,
      ]);
      const actualHash = await sha256(archive);
      if (actualHash !== spec.sha256)
        throw new Error(`JDK archive SHA-256 mismatch: ${actualHash}`);
      run('tar', ['-xzf', archive, '-C', temporary]);
      const extractedHome = resolve(temporary, spec.archiveHome);
      if (!extractedHome.startsWith(`${temporary}${sep}`)) {
        throw new Error('JDK archive home escapes its temporary install directory');
      }
      await stat(join(extractedHome, 'bin/java'));
      await mkdir(dirname(home), { recursive: true });
      // Publish the cached JDK only after its archive hash and expected executable path pass.
      await rename(extractedHome, home);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const env = {
    ...runtimeEnv,
    JAVA_HOME: home,
    PATH: `${join(home, 'bin')}${process.platform === 'win32' ? ';' : ':'}${runtimeEnv.PATH || ''}`,
  };
  const version = run(java, ['-version'], { env });
  if (!version.includes(spec.version.split('+')[0]))
    throw new Error(`JDK reports ${version}; expected ${spec.version}`);
  return { home, env };
}

async function main() {
  const { platform: requestedPlatform, remaining } = parsePlatformArgument(process.argv.slice(2));
  if (remaining.length > 0) throw new Error('Use only --platform all or --platform linux');
  const selection = selectQualityTools(versions, platform, requestedPlatform);
  await mkdir(cache, { recursive: true });

  let runtimeEnv = process.env;
  if (selection.jdk) {
    // Keep JDK lookup and its PATH/JAVA_HOME contract together for every selected platform.
    ({ env: runtimeEnv } = await ensureJdk(selection.jdk, process.env));
  }
  for (const [name, spec] of Object.entries(selection.tools)) {
    await ensureAsset(name, spec, runtimeEnv);
  }
  if (selection.jdk) {
    const env = { ...runtimeEnv, BUNDLE_GEMFILE: join(root, 'scripts/quality/Gemfile') };
    run('bundle', ['install', '--jobs', '4', '--retry', '3'], { env });
    const rubocop = run('bundle', ['exec', 'rubocop', '--version'], { env });
    if (!rubocop.includes('1.91.0')) {
      throw new Error(`RuboCop reports ${rubocop}; expected 1.91.0`);
    }
    const groovyPackage = JSON.parse(
      await readFile(join(root, 'node_modules/npm-groovy-lint/package.json'), 'utf8'),
    );
    if (groovyPackage.version !== '18.0.0') {
      throw new Error(`npm-groovy-lint package is ${groovyPackage.version}; expected 18.0.0`);
    }
    console.log(`Ruby tools are locked by ${env.BUNDLE_GEMFILE}.`);
  }

  console.log(`Pinned ${requestedPlatform} quality tools installed for ${platform}.`);
}

main().catch((error) => {
  console.error(`Quality tool setup failed: ${error.message}`);
  process.exitCode = 1;
});
