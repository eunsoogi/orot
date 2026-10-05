import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const destination = join(cache, name, spec.version);
  const executable = join(destination, spec.binary);
  try {
    await stat(executable);
    assertVersion(executable, spec.version, runtimeEnv);
    return executable;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const parent = join(cache, name);
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

    let source = archive;
    if (spec.archive === 'zip') {
      run('unzip', ['-q', archive, '-d', temporary]);
      source = join(temporary, spec.binary);
    } else if (spec.archive === 'tar.gz') {
      run('tar', ['-xzf', archive, '-C', temporary]);
      source = join(temporary, spec.binary);
    }
    const relative = resolve(source);
    if (!relative.startsWith(`${temporary}${sep}`))
      throw new Error(`${name} archive path escapes its install directory`);
    await stat(source);
    const staging = join(temporary, 'installed');
    const stagedExecutable = join(staging, spec.binary);
    await mkdir(dirname(stagedExecutable), { recursive: true });
    await copyFile(source, stagedExecutable);
    await chmod(stagedExecutable, 0o755);
    assertVersion(stagedExecutable, spec.version, runtimeEnv);
    // Publish a version directory only after its binary reports the pinned release.
    await rename(staging, destination);
    return executable;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function ensureJdk(runtimeEnv) {
  const home = join(cache, 'jdk', versions.jdk.version, 'Contents/Home');
  const java = join(home, 'bin/java');
  try {
    await stat(java);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = join(cache, 'jdk');
    await mkdir(parent, { recursive: true });
    const temporary = await mkdtemp(join(parent, '.install-'));
    try {
      const archive = join(temporary, basename(new URL(versions.jdk.url).pathname));
      run('curl', [
        '--fail',
        '--location',
        '--retry',
        '3',
        '--connect-timeout',
        '30',
        '--max-time',
        '300',
        versions.jdk.url,
        '--output',
        archive,
      ]);
      const actualHash = await sha256(archive);
      if (actualHash !== versions.jdk.sha256)
        throw new Error(`JDK archive SHA-256 mismatch: ${actualHash}`);
      run('tar', ['-xzf', archive, '-C', temporary]);
      const extractedHome = join(temporary, 'jdk-17.0.20.1+1/Contents/Home');
      await stat(join(extractedHome, 'bin/java'));
      await mkdir(dirname(home), { recursive: true });
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
  if (!version.includes(versions.jdk.version.split('+')[0]))
    throw new Error(`JDK reports ${version}; expected ${versions.jdk.version}`);
  return { home, env };
}

async function main() {
  if (platform !== versions.platform)
    throw new Error(`Pinned quality tools support ${versions.platform}; this host is ${platform}`);
  await mkdir(cache, { recursive: true });
  const jdk = await ensureJdk(process.env);
  for (const [name, spec] of Object.entries(versions.tools)) await ensureAsset(name, spec, jdk.env);

  const clangFormat = run('xcrun', ['--find', 'clang-format']);
  assertVersion(clangFormat, versions.clangFormat.version, jdk.env);
  const env = { ...jdk.env, BUNDLE_GEMFILE: join(root, 'scripts/quality/Gemfile') };
  run('bundle', ['install', '--jobs', '4', '--retry', '3'], { env });
  const rubocop = run('bundle', ['exec', 'rubocop', '--version'], { env });
  if (!rubocop.includes('1.91.0')) throw new Error(`RuboCop reports ${rubocop}; expected 1.91.0`);
  const groovyPackage = JSON.parse(
    await readFile(join(root, 'node_modules/npm-groovy-lint/package.json'), 'utf8'),
  );
  if (groovyPackage.version !== '18.0.0')
    throw new Error(`npm-groovy-lint package is ${groovyPackage.version}; expected 18.0.0`);

  console.log(`Pinned quality tools installed for ${platform}; JDK ${versions.jdk.version}.`);
  console.log(`Ruby tools are locked by ${env.BUNDLE_GEMFILE}.`);
}

main().catch((error) => {
  console.error(`Quality tool setup failed: ${error.message}`);
  process.exitCode = 1;
});
