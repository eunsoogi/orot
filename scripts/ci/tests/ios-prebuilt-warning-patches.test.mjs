import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const native = resolve('apps/mobile/node_modules/react-native');
const { repairPrebuilt } = require(join(native, 'scripts/orot-prebuilt-headers.cjs'));
const textualHeaders = require(join(native, 'scripts/orot-textual-headers.json'));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orot-header-repair-'));
  const framework = join(root, 'React.xcframework/ios-arm64-simulator/React.framework');
  const headers = join(framework, 'Headers');
  mkdirSync(headers, { recursive: true });
  mkdirSync(join(framework, 'Modules'));
  writeFileSync(join(framework, 'React'), 'synthetic binary integrity sentinel');
  writeFileSync(
    join(framework, 'Modules/module.modulemap'),
    'framework module React {\n  umbrella header "React-umbrella.h"\n  export *\n}\n',
  );
  for (const name of textualHeaders)
    writeFileSync(join(headers, name), '// Explicit include only.\n');
  for (const source of [
    'Libraries/Network/RCTHTTPRequestHandler.h',
    'React/Base/RCTMultipartDataTask.h',
    'React/CoreModules/RCTWebSocketModule.h',
    'React/Fabric/Utils/RCTReactTaggedView.h',
  ]) {
    cpSync(join(native, source), join(headers, source.split('/').at(-1)));
  }
  const shadow = join(root, 'Headers/react/renderer/mounting/ShadowViewMutation.h');
  mkdirSync(dirname(shadow), { recursive: true });
  cpSync(join(native, 'ReactCommon/react/renderer/mounting/ShadowViewMutation.h'), shadow);
  chmodSync(shadow, 0o444); // CocoaPods locks copied headers after preparation.
  const legacy = join(root, 'Headers/React_RCTAppDelegate/RCTUIConfiguratorProtocol.h');
  mkdirSync(dirname(legacy), { recursive: true });
  cpSync(join(native, 'Libraries/AppDelegate/RCTUIConfiguratorProtocol.h'), legacy);
  return { root, framework, headers, shadow, legacy };
}

test('prebuilt repair preserves binary bytes, explicit includes, readonly modes and repeatability', () => {
  const f = fixture();
  try {
    repairPrebuilt(f.root);
    const snapshot = readFileSync(f.shadow, 'utf8');
    assert.equal((snapshot.match(/\[\[deprecated\(/g) ?? []).length, 3);
    assert.equal(statSync(f.shadow).mode & 0o777, 0o444);
    assert.equal(
      readFileSync(join(f.framework, 'React'), 'utf8'),
      'synthetic binary integrity sentinel',
    );
    const map = readFileSync(join(f.framework, 'Modules/module.modulemap'), 'utf8');
    for (const header of textualHeaders) assert.ok(map.includes(`textual header "${header}"`));
    assert.match(
      readFileSync(join(f.headers, 'RCTReactTaggedView.h'), 'utf8'),
      /isEqual:\(nullable id\)/,
    );
    assert.match(
      readFileSync(f.legacy, 'utf8'),
      /customizeRootView:\(RCTRootView \*\)rootView\s+__attribute__\(\(deprecated\(/,
    );
    repairPrebuilt(f.root);
    assert.equal(readFileSync(f.shadow, 'utf8'), snapshot);
    assert.equal(readFileSync(join(f.framework, 'Modules/module.modulemap'), 'utf8'), map);
    assert.ok(readdirSync(dirname(f.shadow)).every((name) => !name.includes('.orot-')));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('unexpected artifact declarations stop the repair instead of silently skipping it', () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.headers, 'RCTHTTPRequestHandler.h'),
      '// Incompatible upstream declaration.\n',
    );
    assert.throws(() => repairPrebuilt(f.root), /Unexpected React 0.87.1 header declaration/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
