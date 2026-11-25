import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { onnxArchivePins, verifyOnnxArchives } from '../verify-onnx-artifact-cache.mjs';

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
  const check = action.indexOf('verify-onnx-artifact-cache.mjs verify');
  const save = action.indexOf('actions/cache/save@');
  assert.ok(check >= 0 && save > check);
  assert.match(action.slice(check, save), /github.ref == 'refs\/heads\/main'/u);
});
