import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildInventory, formatInventory, getPolicy } from '../inventory.mjs';
import { parsePlatformArgument, selectPlatformEntries, selectQualityTools } from '../platforms.mjs';

const policy = getPolicy();
const versions = JSON.parse(
  readFileSync(new URL('../tool-versions.json', import.meta.url), 'utf8'),
);

test('Linux and macOS inventories cover every maintained file exactly once', async () => {
  const inventory = await buildInventory();
  const maintained = inventory.filter((entry) => entry.kind === 'surface');
  const linux = selectPlatformEntries(inventory, policy, 'linux').filter(
    (entry) => entry.kind === 'surface',
  );
  const macos = selectPlatformEntries(inventory, policy, 'macos').filter(
    (entry) => entry.kind === 'surface',
  );
  const linuxPaths = new Set(linux.map((entry) => entry.path));
  const macosPaths = new Set(macos.map((entry) => entry.path));

  // Every maintained file must have one explicit owner so a partition cannot silently omit it.
  assert.equal(linuxPaths.size + macosPaths.size, maintained.length);
  assert.equal([...linuxPaths].filter((path) => macosPaths.has(path)).length, 0);
  assert.deepEqual(
    [...linuxPaths, ...macosPaths].sort(),
    maintained.map((entry) => entry.path).sort(),
  );
  for (const entry of maintained) {
    assert.ok(['linux', 'macos'].includes(policy.surfaces[entry.surface].platform));
  }
  assert.match(formatInventory(inventory), /objective-c \(\d+; macos\)/);
  assert.match(formatInventory(inventory), /javascript \(\d+; linux\)/);
});

test('platform selection requires a supported explicit value and preserves other options', () => {
  assert.deepEqual(parsePlatformArgument(['--exclude', 'apps/mobile/', '--platform', 'linux']), {
    platform: 'linux',
    remaining: ['--exclude', 'apps/mobile/'],
  });
  assert.deepEqual(parsePlatformArgument(['--', '--platform', 'linux']), {
    platform: 'linux',
    remaining: [],
  });
  assert.throws(() => parsePlatformArgument(['--platform', 'windows']), /Use --platform/);
  assert.throws(
    () => parsePlatformArgument(['--platform', 'linux', '--platform', 'macos']),
    /only once/,
  );
});

test('Linux selects host-pinned portable tools and JDK without requiring Xcode', () => {
  const selected = selectQualityTools(versions, 'linux-x64', 'linux');
  const expectedTools = Object.keys(versions.tools).filter(
    (name) => versions.tools[name].platform === 'linux',
  );

  assert.deepEqual(Object.keys(selected.tools).sort(), expectedTools.sort());
  assert.equal(selected.jdk.url, versions.jdk.platforms['linux-x64'].url);
  assert.equal(selected.clangFormat, null);
  // The Linux release archive contains this entry name; setup stages it under the selected name.
  assert.equal(selected.tools.swiftformat.binary, 'swiftformat_linux');
  for (const [name, tool] of Object.entries(selected.tools)) {
    assert.equal(tool.url, versions.tools[name].assets['linux-x64'].url);
    assert.match(tool.sha256, /^[a-f0-9]{64}$/);
  }
  assert.throws(() => selectQualityTools(versions, 'linux-x64', 'macos'), /require Xcode/);
});

test('macOS keeps the existing pinned portable assets and Xcode formatter', () => {
  const selected = selectQualityTools(versions, 'darwin-arm64', 'all');
  const originalMacHashes = {
    swiftformat: '7cb1cb1fae04932047c7015441c543848e8e60e1572d808d080e0a1f1661114a',
    shellcheck: '339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f',
    shfmt: '9680526be4a66ea1ffe988ed08af58e1400fe1e4f4aef5bd88b20bb9b3da33f8',
    ktlint: 'a3fd620207d5c40da6ca789b95e7f823c54e854b7fade7f613e91096a3706d75',
    actionlint: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  };

  assert.deepEqual(
    Object.fromEntries(Object.entries(selected.tools).map(([name, tool]) => [name, tool.sha256])),
    originalMacHashes,
  );
  assert.equal(selected.jdk.url, versions.jdk.platforms['darwin-arm64'].url);
  assert.equal(selected.clangFormat.version, versions.clangFormat.version);
  assert.deepEqual(selectQualityTools(versions, 'darwin-arm64', 'macos').tools, {});
  assert.equal(selectQualityTools(versions, 'darwin-arm64', 'macos').jdk, null);
});
