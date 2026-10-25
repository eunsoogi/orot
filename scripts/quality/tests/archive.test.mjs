import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  archiveExtractionPlan,
  hasCompletePinnedAsset,
  pinnedArchiveEntries,
} from '../archive.mjs';

test('selectively extracts only pinned LLVM executable and runtime paths', () => {
  const spec = {
    archive: 'tar.xz',
    binary: 'LLVM-21.1.8-Linux-X64/bin/clang-format',
    archiveEntries: [
      'LLVM-21.1.8-Linux-X64/bin/clang-format',
      'LLVM-21.1.8-Linux-X64/lib/libclang-cpp.so.21.1',
    ],
  };

  assert.deepEqual(pinnedArchiveEntries(spec), spec.archiveEntries);
  assert.deepEqual(archiveExtractionPlan(spec, '/tmp/LLVM.tar.xz', '/tmp/extract'), {
    command: 'tar',
    args: ['-xJf', '/tmp/LLVM.tar.xz', '-C', '/tmp/extract', '--', ...spec.archiveEntries],
  });
});

test('keeps ordinary pinned archive extraction behavior unchanged', () => {
  assert.deepEqual(
    archiveExtractionPlan({ archive: 'zip', binary: 'swiftformat' }, '/tmp/tool.zip', '/tmp/out'),
    { command: 'unzip', args: ['-q', '/tmp/tool.zip', '-d', '/tmp/out'] },
  );
  assert.deepEqual(
    archiveExtractionPlan(
      { archive: 'tar.gz', binary: 'actionlint' },
      '/tmp/tool.tar.gz',
      '/tmp/out',
    ),
    { command: 'tar', args: ['-xzf', '/tmp/tool.tar.gz', '-C', '/tmp/out'] },
  );
});

test('rejects unsafe, duplicate, or incomplete pinned archive selections', () => {
  const binary = 'LLVM/bin/clang-format';
  for (const entry of ['/etc/passwd', '../outside', 'LLVM/../outside', 'LLVM\\outside', '-C']) {
    assert.throws(
      () => pinnedArchiveEntries({ archive: 'tar.xz', binary, archiveEntries: [binary, entry] }),
      /Unsafe or duplicate pinned archive entry/,
    );
  }
  assert.throws(
    () => pinnedArchiveEntries({ archive: 'tar.xz', binary, archiveEntries: [binary, binary] }),
    /Unsafe or duplicate pinned archive entry/,
  );
  assert.throws(
    () => pinnedArchiveEntries({ archive: 'tar.xz', binary, archiveEntries: ['LLVM/lib/libx.so'] }),
    /must include the executable/,
  );
  assert.throws(
    () => pinnedArchiveEntries({ archive: 'zip', binary, archiveEntries: [binary] }),
    /requires a tar archive/,
  );
});

test('treats a missing selected runtime library as an incomplete asset cache', async () => {
  const spec = {
    archive: 'tar.xz',
    binary: 'LLVM/bin/clang-format',
    archiveEntries: ['LLVM/bin/clang-format', 'LLVM/lib/libclang-cpp.so.21.1'],
  };
  const temporary = await mkdtemp(join(tmpdir(), 'orot-quality-asset-cache-'));
  const destination = join(temporary, 'clang-format');
  try {
    await mkdir(join(destination, dirname(spec.binary)), { recursive: true });
    await writeFile(join(destination, spec.binary), 'binary');
    assert.equal(await hasCompletePinnedAsset(spec, destination), false);

    const runtimeLibrary = join(destination, spec.archiveEntries[1]);
    await mkdir(dirname(runtimeLibrary), { recursive: true });
    await writeFile(runtimeLibrary, 'runtime');
    assert.equal(await hasCompletePinnedAsset(spec, destination), true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
