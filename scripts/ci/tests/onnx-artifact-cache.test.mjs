import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { onnxArchivePins, verifyOnnxArchives } from '../verify-onnx-artifact-cache.mjs';
import { isPinnedOnnxTlsFailure, seedVerifiedOnnxMirror } from '../seed-onnx-verified-mirror.mjs';

const manifestAt = 'vendor/onnxruntime-swift-package-manager/Package.swift';
const artifactAction = '.github/actions/ios-onnx-artifact-cache/action.yml';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contents = [
  Buffer.from('synthetic runtime archive'),
  Buffer.from('synthetic extensions archive'),
];

test('pinned manifest maps only the two original SwiftPM artifact files', async () => {
  const manifest = await readFile(manifestAt, 'utf8');
  const paths = onnxArchivePins(manifest, '/synthetic/cache').map((pin) => basename(pin.path));
  assert.deepEqual(paths, [
    'https___download_onnxruntime_ai_pod_archive_onnxruntime_c_1_24_2_zip',
    'https___download_onnxruntime_ai_pod_archive_onnxruntime_extensions_c_0_13_0_zip',
  ]);
  assert.throws(
    () =>
      onnxArchivePins(
        manifest.replace('https://download.onnxruntime.ai/', 'https://unverified.invalid/'),
      ),
    /exact ONNX package archive pins/,
  );
});

test('verification rejects missing, modified and symlinked entries without rewriting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-onnx-cache-'));
  try {
    const manifest = await readFile(manifestAt, 'utf8');
    let index = 0;
    const pins = onnxArchivePins(
      manifest.replace(
        /checksum: "[a-f0-9]{64}"/gu,
        () => `checksum: "${digest(contents[index++])}"`,
      ),
      root,
    );
    await assert.rejects(verifyOnnxArchives(pins), /archive for onnxruntime is absent/);
    await Promise.all(pins.map((pin, index) => writeFile(pin.path, contents[index])));
    await verifyOnnxArchives(pins);
    await writeFile(pins[1].path, Buffer.from('modified'));
    await assert.rejects(verifyOnnxArchives(pins), /archive for onnxruntime_extensions/);
    const alternatePath = join(root, 'same-bytes-at-other-path');
    await writeFile(alternatePath, contents[1]);
    await rm(pins[1].path);
    await symlink(alternatePath, pins[1].path);
    await assert.rejects(verifyOnnxArchives(pins), /archive for onnxruntime_extensions/);
    assert.deepEqual(await readFile(alternatePath), contents[1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hosted app builds restore exact keys, validate hits, and only seed main after verification', async () => {
  const action = await readFile(artifactAction, 'utf8');
  const consumers = await readFile('.github/actions/ios-platform-dependencies/action.yml', 'utf8');
  assert.match(consumers, /uses: \.\/\.github\/actions\/ios-onnx-artifact-cache/);
  assert.match(action, /actions\/cache\/restore@/);
  assert.doesNotMatch(action, /restore-keys:|ORT_POD_LOCAL_PATH|insecure|GITHUB_TOKEN/u);
  assert.match(
    action,
    /cache-hit != 'true'[\s\S]*fail-on-warning\.mjs -- xcrun swift package[\s\S]* --scratch-path .* resolve/u,
  );
  const initial = action.indexOf('--scratch-path "$scratch/original" resolve; then');
  const mirror = action.indexOf('seed-onnx-verified-mirror.mjs "$original"');
  const retry = action.indexOf('--scratch-path "$scratch/verified" resolve');
  const check = action.indexOf('verify-onnx-artifact-cache.mjs verify');
  assert.ok(initial >= 0 && initial < mirror && mirror < retry && retry < check);
  const save = action.indexOf('actions/cache/save@');
  assert.ok(check >= 0 && save > check);
  assert.match(action.slice(check, save), /github.ref == 'refs\/heads\/main'/u);
});

test('only exact TLS-transport failures with a clean warning gate can use fallback', async () => {
  const manifest = await readFile(manifestAt, 'utf8');
  const pins = onnxArchivePins(manifest);
  const gate =
    'IOS_WARNING_GATE occurrences=0 accepted=0 blocking=0 child_status=1 signal=none result=failed';
  const errors = pins.map(
    ({ target, url }) =>
      `error: failed downloading '${url}' which is required by binary target '${target}': downloadError("The certificate for this server is invalid. Synthetic.")`,
  );
  const known = [...errors, 'error: fatalError', gate].join('\n');
  assert.equal(isPinnedOnnxTlsFailure(known, pins), true);
  assert.equal(isPinnedOnnxTlsFailure(known.replace('blocking=0', 'blocking=1'), pins), false);
  assert.equal(
    isPinnedOnnxTlsFailure(known.replace('child_status=1', 'child_status=0'), pins),
    false,
  );
  assert.equal(isPinnedOnnxTlsFailure(known + '\n  error: failed validation', pins), false);
  assert.equal(
    isPinnedOnnxTlsFailure(known.replace('The certificate', 'An HTTP error'), pins),
    false,
  );
  assert.equal(
    isPinnedOnnxTlsFailure(known.replace('download.onnxruntime.ai', 'untrusted.test'), pins),
    false,
  );
  assert.equal(isPinnedOnnxTlsFailure(gate, pins), false);
});

test('cold mirror verifies both bytes before publishing either and retains official good files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-onnx-mirror-'));
  try {
    const manifest = await readFile(manifestAt, 'utf8');
    let index = 0;
    const pins = onnxArchivePins(
      manifest.replace(
        /checksum: "[a-f0-9]{64}"/gu,
        () => `checksum: "${digest(contents[index++])}"`,
      ),
      root,
    );
    const download =
      (wrong = false) =>
      async (url, path) => {
        const asset = new URL(url).pathname.split('/').at(-1);
        const found = pins.findIndex((pin) => pin.archive === asset);
        assert.ok(found >= 0);
        await writeFile(path, wrong && found === 1 ? Buffer.from('untrusted') : contents[found]);
      };
    await assert.rejects(
      seedVerifiedOnnxMirror(pins, download(true)),
      /archive for onnxruntime_extensions/,
    );
    assert.deepEqual(await readdir(root), []);
    await writeFile(pins[1].path, Buffer.from('prior invalid cache entry'));
    await assert.rejects(
      seedVerifiedOnnxMirror(pins, download()),
      /archive for onnxruntime_extensions/,
    );
    assert.deepEqual(await readdir(root), [basename(pins[1].path)]);
    assert.equal(await readFile(pins[1].path, 'utf8'), 'prior invalid cache entry');
    await rm(pins[1].path);
    await writeFile(pins[0].path, contents[0]);
    const before = await stat(pins[0].path);
    await seedVerifiedOnnxMirror(pins, download());
    await verifyOnnxArchives(pins);
    const after = await stat(pins[0].path);
    assert.equal(before.ino, after.ino);
    assert.deepEqual((await readdir(root)).sort(), pins.map((pin) => basename(pin.path)).sort());
    await assert.rejects(
      seedVerifiedOnnxMirror(
        pins.map((pin) => ({ ...pin, archive: pin.archive.replace('1.24.2', '2.0.0') })),
        download(),
      ),
      /No alternate transport is approved/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
