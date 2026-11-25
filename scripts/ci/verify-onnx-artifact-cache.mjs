import { createHash } from 'node:crypto';
import { constants, appendFileSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const manifestPath = 'vendor/onnxruntime-swift-package-manager/Package.swift';
const targets = ['onnxruntime', 'onnxruntime_extensions'];
const cacheRoot = join(homedir(), 'Library/Caches/org.swift.swiftpm/artifacts');

/** The independent verifier reads the immutable upstream manifest; don't trust a cache key as a digest. */
export function onnxArchivePins(manifest, root = cacheRoot) {
  const remote = [
    ...manifest.matchAll(
      /Target\.binaryTarget\(name:\s*"(onnxruntime(?:_extensions)?)",\s*url:\s*"(https:\/\/download\.onnxruntime\.ai\/pod-archive-onnxruntime(?:-extensions)?-c-[0-9.]+\.zip)",\s*(?:\/\/[^\n]*\n\s*)?checksum:\s*"([0-9a-f]{64})"\)/gu,
    ),
  ];
  if (
    remote.length !== targets.length ||
    targets.some((target) => remote.filter(([, name]) => name === target).length !== 1)
  )
    throw new Error('Cannot verify the exact ONNX package archive pins.');
  return remote.map(([, target, url, checksum]) => {
    const archive = url.split('/').at(-1);
    const extension = target === 'onnxruntime_extensions';
    if (archive.startsWith('pod-archive-onnxruntime-extensions-') !== extension)
      throw new Error('ONNX archive does not match its declared binary target.');
    // SwiftPM's standard artifact cache uses the original URL with its separators escaped.
    return { target, url, archive, path: join(root, url.replace(/[^a-z0-9]/giu, '_')), checksum };
  });
}

/** Restore only exact original ZIPs. Reject missing files, links and content changes. */
export async function verifyOnnxArchives(pins) {
  for (const { target, path, checksum } of pins) {
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!(await file.stat()).isFile()) throw new Error('Not a regular archive.');
      const digest = createHash('sha256');
      for await (const chunk of file.createReadStream({ autoClose: false })) digest.update(chunk);
      if (digest.digest('hex') !== checksum) throw new Error('Checksum mismatch.');
    } catch {
      throw new Error(
        `Pinned SwiftPM archive for ${target} is absent or failed independent verification.`,
      );
    } finally {
      await file?.close();
    }
  }
}

async function main() {
  const pins = onnxArchivePins(readFileSync(manifestPath, 'utf8'));
  const [action, path, extra] = process.argv.slice(2);
  if (action === 'paths' && path && !extra) {
    appendFileSync(
      path,
      `paths<<ONNX_ARCHIVE_PATHS\n${pins.map((pin) => pin.path).join('\n')}\nONNX_ARCHIVE_PATHS\n`,
    );
  } else if (action === 'verify' && !path) {
    await verifyOnnxArchives(pins);
    console.log('Verified two pinned SwiftPM ONNX archives.');
  } else {
    throw new Error('Usage: verify-onnx-artifact-cache.mjs paths <output> | verify');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
