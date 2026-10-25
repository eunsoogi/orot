import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildInventory, formatInventory, getPolicy } from '../inventory.mjs';
import {
  parsePlatformArgument,
  parseQualityArguments,
  selectPlatformEntries,
  selectQualityTools,
  selectSurfaceEntries,
} from '../platforms.mjs';

const policy = getPolicy();
const versions = JSON.parse(
  readFileSync(new URL('../tool-versions.json', import.meta.url), 'utf8'),
);

test('the Linux inventory covers every maintained file exactly once', async () => {
  const inventory = await buildInventory();
  const maintained = inventory.filter((entry) => entry.kind === 'surface');
  const linux = selectPlatformEntries(inventory, policy, 'linux').filter(
    (entry) => entry.kind === 'surface',
  );
  const linuxPaths = new Set(linux.map((entry) => entry.path));

  // Each maintained path belongs to Linux because the quality gate has one required partition.
  assert.equal(linuxPaths.size, maintained.length);
  assert.deepEqual([...linuxPaths].sort(), maintained.map((entry) => entry.path).sort());
  for (const entry of maintained) {
    assert.equal(policy.surfaces[entry.surface].platform, 'linux');
  }
  const formattedInventory = formatInventory(inventory);
  const objectiveCCount = linux.filter((entry) => entry.surface === 'objective-c').length;

  // Keep the displayed count tied to discovered sources so new native modules do not stale it.
  assert.ok(objectiveCCount > 0);
  assert.ok(formattedInventory.includes(`objective-c (${objectiveCCount}; linux)`));
  assert.match(formattedInventory, /javascript \(\d+; linux\)/);
});

test('quality selection parses platform and lint surface without dropping unrecognized options', () => {
  assert.deepEqual(parsePlatformArgument(['--platform', 'linux']), {
    platform: 'linux',
    remaining: [],
  });
  assert.throws(
    () => parsePlatformArgument(['--surface', 'javascript']),
    /surface is available only for a lint invocation/,
  );
  assert.deepEqual(parseQualityArguments(['--platform', 'linux']), {
    platform: 'linux',
    surface: null,
    remaining: [],
  });
  assert.deepEqual(parseQualityArguments(['--surface', 'javascript', '--platform', 'linux']), {
    platform: 'linux',
    surface: 'javascript',
    remaining: [],
  });
  assert.deepEqual(parseQualityArguments(['--', '--platform', 'linux']), {
    platform: 'linux',
    surface: null,
    remaining: [],
  });
  assert.deepEqual(parseQualityArguments(['--exclude', 'apps/mobile/', '--platform', 'linux']), {
    platform: 'linux',
    surface: null,
    remaining: ['--exclude', 'apps/mobile/'],
  });
  assert.throws(() => parseQualityArguments(['--platform', 'windows']), /Use --platform/);
  assert.throws(() => parseQualityArguments(['--platform', 'macos']), /Use --platform/);
  assert.throws(
    () => parseQualityArguments(['--platform', 'linux', '--platform', 'macos']),
    /only once/,
  );
  assert.throws(
    () => parseQualityArguments(['--surface', 'javascript', '--surface', 'shell']),
    /only once/,
  );
  assert.throws(() => parseQualityArguments(['--surface']), /requires a value/);
});

test('surface lint selection filters one full-inventory language without path exclusions', async () => {
  const inventory = await buildInventory();
  const linux = selectPlatformEntries(inventory, policy, 'linux');
  const maintained = inventory.filter((entry) => entry.kind === 'surface');

  for (const surface of Object.keys(policy.surfaces)) {
    const selected = selectSurfaceEntries(linux, policy, surface);
    const expected = maintained.filter((entry) => entry.surface === surface);
    assert.deepEqual(selected, expected);
  }
  const emptySurface = Object.keys(policy.surfaces).find(
    (surface) => !maintained.some((entry) => entry.surface === surface),
  );
  if (emptySurface) {
    // Configured surfaces with no current files keep their independent CI leaf without hiding inventory errors.
    assert.deepEqual(selectSurfaceEntries(linux, policy, emptySurface), []);
  }
  assert.throws(
    () => selectSurfaceEntries(linux, policy, 'not-configured'),
    /Unknown quality surface/,
  );
});

test('Linux selects host-pinned portable tools without requiring a JDK or Xcode', () => {
  const selected = selectQualityTools(versions, 'linux-x64', 'linux');
  const expectedTools = Object.keys(versions.tools).filter(
    (name) => versions.tools[name].platform === 'linux',
  );

  assert.deepEqual(Object.keys(selected.tools).sort(), expectedTools.sort());
  assert.equal(versions.jdk, undefined);
  assert.equal(selected.jdk, undefined);
  assert.equal(selected.tools.clangFormat.version, '21.1.8');
  assert.equal(
    selected.tools.clangFormat.sha256,
    'b3b7f2801d15d50736acea3c73982994d025b01c2f035b91ae3b49d1b575732b',
  );
  assert.deepEqual(selected.tools.clangFormat.archiveEntries, [
    'LLVM-21.1.8-Linux-X64/bin/clang-format',
    'LLVM-21.1.8-Linux-X64/lib/libclang-cpp.so.21.1',
  ]);
  // The Linux release archive contains this entry name; setup stages it under the selected name.
  assert.equal(selected.tools.swiftformat.binary, 'swiftformat_linux');
  for (const [name, tool] of Object.entries(selected.tools)) {
    assert.equal(tool.url, versions.tools[name].assets['linux-x64'].url);
    assert.match(tool.sha256, /^[a-f0-9]{64}$/);
  }
  assert.throws(
    () => selectQualityTools(versions, 'linux-x64', 'macos'),
    /Unknown quality platform/,
  );
});

test('macOS uses its pinned host binaries for the complete Linux-owned quality inventory', () => {
  const selected = selectQualityTools(versions, 'darwin-arm64', 'all');
  const originalMacHashes = {
    swiftformat: '7cb1cb1fae04932047c7015441c543848e8e60e1572d808d080e0a1f1661114a',
    shellcheck: '339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f',
    shfmt: '9680526be4a66ea1ffe988ed08af58e1400fe1e4f4aef5bd88b20bb9b3da33f8',
    actionlint: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
    clangFormat: 'b95bdd32a33a81ee4d40363aaeb26728a26783fcef26a4d80f65457433ea4669',
  };

  assert.deepEqual(
    Object.fromEntries(Object.entries(selected.tools).map(([name, tool]) => [name, tool.sha256])),
    originalMacHashes,
  );
  assert.equal(versions.jdk, undefined);
  assert.equal(selected.jdk, undefined);
  assert.equal(selected.tools.clangFormat.version, '21.1.8');
  assert.equal(
    selected.tools.clangFormat.sha256,
    'b95bdd32a33a81ee4d40363aaeb26728a26783fcef26a4d80f65457433ea4669',
  );
  assert.deepEqual(selected.tools.clangFormat.archiveEntries, [
    'LLVM-21.1.8-macOS-ARM64/bin/clang-format',
  ]);
});
