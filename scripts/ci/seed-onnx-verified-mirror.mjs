import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { onnxArchivePins, verifyOnnxArchives } from './verify-onnx-artifact-cache.mjs';

const manifestPath = 'vendor/onnxruntime-swift-package-manager/Package.swift';
// These are untrusted transport bytes, not dependency authority. The artifacts retain
// their original Microsoft MIT notices and must match the checked-in Microsoft pins.
const mirror =
  'https://github.com/BasedHardware/omi/releases/download/desktop-build-deps-onnx-1.24.2-extensions-0.13.0/';
const approved = new Set([
  'pod-archive-onnxruntime-c-1.24.2.zip',
  'pod-archive-onnxruntime-extensions-c-0.13.0.zip',
]);
const regularCurl = promisify(execFile);

/** Only the diagnosed certificate failures can enter the alternate byte transport. */
export function isPinnedOnnxTlsFailure(log, pins) {
  if (
    !/^IOS_WARNING_GATE occurrences=0 accepted=0 blocking=0 child_status=[1-9][0-9]* signal=none result=failed$/mu.test(
      log,
    )
  )
    return false;
  const errors = log
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^error:/u.test(line) && line !== 'error: fatalError');
  return (
    errors.length > 0 &&
    errors.every((line) =>
      pins.some(({ target, url }) =>
        line.startsWith(
          `error: failed downloading '${url}' which is required by binary target '${target}': downloadError("The certificate for this server is invalid.`,
        ),
      ),
    )
  );
}

async function fetchArchive(url, path) {
  await regularCurl('curl', [
    '--disable',
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--tlsv1.2',
    '--location',
    '--fail',
    '--silent',
    '--show-error',
    '--connect-timeout',
    '15',
    '--max-time',
    '120',
    '--max-filesize',
    '67108864',
    '--output',
    path,
    url,
  ]);
}

/** Independently hash both staged originals before linking either cache entry.
 * A prior valid official download is not replaced, and if publication fails,
 * remove only entries created by this attempt. SwiftPM still checks its pins. */
export async function seedVerifiedOnnxMirror(pins, download = fetchArchive) {
  if (
    pins.length !== approved.size ||
    new Set(pins.map((pin) => pin.archive)).size !== approved.size ||
    !pins.every((pin) => approved.has(pin.archive)) ||
    new Set(pins.map((pin) => dirname(pin.path))).size !== 1
  )
    throw new Error('No alternate transport is approved for these exact ONNX archive names.');
  const cache = dirname(pins[0].path);
  await mkdir(cache, { recursive: true });
  const stage = await mkdtemp(join(cache, '.orot-onnx-mirror-'));
  const published = [];
  try {
    const candidates = pins.map((pin) => ({ ...pin, path: join(stage, basename(pin.path)) }));
    for (const candidate of candidates) {
      await download(mirror + candidate.archive, candidate.path);
    }
    await verifyOnnxArchives(candidates);
    for (const [index, pin] of pins.entries()) {
      try {
        await link(candidates[index].path, pin.path);
        published.push(pin.path);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await verifyOnnxArchives([pin]);
      }
    }
    await verifyOnnxArchives(pins);
  } catch (error) {
    await Promise.all(published.map((path) => unlink(path)));
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function main() {
  const [logPath, ...extra] = process.argv.slice(2);
  if (!logPath || extra.length)
    throw new Error('Usage: seed-onnx-verified-mirror.mjs <resolver-log>');
  const pins = onnxArchivePins(await readFile(manifestPath, 'utf8'));
  if (!isPinnedOnnxTlsFailure(await readFile(logPath, 'utf8'), pins))
    throw new Error('SwiftPM failed for a reason not covered by the pinned archive fallback.');
  await seedVerifiedOnnxMirror(pins);
  console.log(
    'Seeded two independently verified original ONNX SwiftPM archives from alternate HTTPS transport.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
