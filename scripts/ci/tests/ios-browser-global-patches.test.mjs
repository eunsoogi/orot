import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const appRequire = createRequire(resolve('apps/mobile/package.json'));
const nativeRequire = createRequire(appRequire.resolve('react-native/package.json'));
const babelRequire = createRequire(appRequire.resolve('@babel/core'));
const navigationRequire = createRequire(
  appRequire.resolve('@react-navigation/native/package.json'),
);
const { parse } = babelRequire('@babel/parser');
const traverse = babelRequire('@babel/traverse').default;
const backend = readFileSync(nativeRequire.resolve('react-devtools-core'), 'utf8');
const backendTree = parse(backend);

// Execute the shipped functions, rather than a copy of their implementation.
// The backend's bundled module table keeps Yallist private from public exports.
function shippedFunction(name) {
  let source;
  traverse(backendTree, {
    FunctionDeclaration(path) {
      if (path.node.id?.name === name) source = backend.slice(path.node.start, path.node.end);
    },
  });
  assert.ok(source, `Missing shipped function: ${name}`);
  return source;
}

test('DevTools bundled list iterator works without an unprovided regenerator runtime', () => {
  let installer;
  traverse(backendTree, {
    ObjectProperty(path) {
      if (path.node.key.value === 476 && path.node.value.type === 'ArrowFunctionExpression') {
        installer = backend.slice(path.node.value.start, path.node.value.end);
      }
    },
  });
  assert.ok(installer, 'The pinned DevTools list module must still be identifiable');
  const module = { exports: {} };
  runInNewContext(`(${installer})(module)`, { module });
  class List {
    constructor(values) {
      this.head = values.reduceRight((next, value) => ({ value, next }), null);
    }
  }
  module.exports(List);
  assert.deepEqual([...new List([])], []);
  assert.deepEqual([...new List(['first', '두 번째', 3])], ['first', '두 번째', 3]);
  const iterator = new List([1, 2])[Symbol.iterator]();
  assert.equal(iterator.next().value, 1);
  assert.equal(iterator.return().done, true);
});

test('DevTools storage capability and selection keep browser and native fallbacks', () => {
  const names = [
    'getIsReloadAndProfileSupported',
    'storage_sessionStorageGetItem',
    'storage_sessionStorageSetItem',
    'storage_sessionStorageRemoveItem',
  ];
  const source = names.map(shippedFunction).join('\n');
  function load(globals) {
    return runInNewContext(`${source}\n({${names.join(',')}})`, {
      isSynchronousXHRSupported: () => true,
      ...globals,
    });
  }
  const native = load({});
  assert.equal(native.getIsReloadAndProfileSupported(), false);
  assert.equal(native.storage_sessionStorageGetItem('selection'), null);
  native.storage_sessionStorageSetItem('selection', 'native');
  native.storage_sessionStorageRemoveItem('selection');

  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  const browser = load({ localStorage: storage, sessionStorage: storage });
  assert.equal(browser.getIsReloadAndProfileSupported(), true);
  browser.storage_sessionStorageSetItem('selection', 'browser');
  assert.equal(browser.storage_sessionStorageGetItem('selection'), 'browser');
  browser.storage_sessionStorageRemoveItem('selection');
  assert.equal(browser.storage_sessionStorageGetItem('selection'), null);
});

test('DevTools StyleX lookup tolerates native hosts without browser DOM globals', () => {
  const source = shippedFunction('getPropertyValueForStyleName');
  function load(globals) {
    return runInNewContext(`${source}\ngetPropertyValueForStyleName`, {
      cachedStyleNameToValueMap: new Map(),
      ...globals,
    });
  }

  assert.equal(load({})('button'), null);

  class CSSStyleRule {}
  const rule = Object.assign(Object.create(CSSStyleRule.prototype), {
    cssText: '.button { color: red; }',
    selectorText: '.button',
    style: { getPropertyValue: () => 'red' },
  });
  const browser = load({
    CSSStyleRule,
    document: { styleSheets: [{ cssRules: [rule] }] },
  });
  assert.equal(browser('button'), 'red');
});

test('UTF-8 polyfill uses a real optional Buffer and preserves native fallback', () => {
  const source = readFileSync(appRequire.resolve('fast-text-encoding'), 'utf8');
  for (const buffer of [undefined, Buffer]) {
    const sandbox = { Uint8Array, Uint16Array, ArrayBuffer, Buffer: buffer };
    runInNewContext(source, sandbox);
    const encoder = new sandbox.TextEncoder();
    const decoder = new sandbox.TextDecoder();
    const text = 'plain 한글 🙂';
    assert.equal(decoder.decode(encoder.encode(text)), text);
    assert.throws(() => new sandbox.TextDecoder('utf-8', { fatal: true }), /unsupported/);
    assert.throws(() => decoder.decode(new Uint8Array(), { stream: true }), /unsupported/);
  }
});

test('React Navigation resolves web-only globals through the global object', () => {
  const elementsPackage = navigationRequire.resolve('@react-navigation/elements/package.json');
  const elementsSource = readFileSync(
    resolve(dirname(elementsPackage), 'lib/module/useFrameSize.js'),
    'utf8',
  );
  const navigationSource = readFileSync(
    resolve(
      dirname(appRequire.resolve('@react-navigation/native/package.json')),
      'lib/module/NavigationContainer.js',
    ),
    'utf8',
  );

  assert.match(elementsSource, /new globalThis\.ResizeObserver\(/);
  assert.doesNotMatch(
    elementsSource.replaceAll('globalThis.ResizeObserver', ''),
    /\bnew\s+ResizeObserver\b/,
  );
  assert.match(navigationSource, /globalThis\.REACT_NAVIGATION_DEVTOOLS\.set\(/);
  assert.doesNotMatch(
    navigationSource.replaceAll('globalThis.REACT_NAVIGATION_DEVTOOLS', ''),
    /\bREACT_NAVIGATION_DEVTOOLS\.set\(/,
  );
});

test('React Native exposes the VirtualizedLists feature flag module through package exports', () => {
  const virtualizedListsPackage = nativeRequire.resolve(
    '@react-native/virtualized-lists/package.json',
  );
  const virtualizedList = readFileSync(
    resolve(dirname(virtualizedListsPackage), 'Lists/VirtualizedList.js'),
    'utf8',
  );
  const featureFlagsPath = 'react-native/src/private/featureflags/ReactNativeFeatureFlags';

  assert.match(virtualizedList, new RegExp(`from ['"]${featureFlagsPath}['"]`));
  assert.ok(nativeRequire.resolve(featureFlagsPath).endsWith('ReactNativeFeatureFlags.js'));
});

test('Hermes receives only the React Native runtime globals needed by its bundle', () => {
  const globalsPath = nativeRequire.resolve('react-native/scripts/orot-hermes-globals');
  const xcodeScriptPath = nativeRequire.resolve('react-native/scripts/react-native-xcode.sh');
  const globalsSource = readFileSync(globalsPath, 'utf8');
  const xcodeScript = readFileSync(xcodeScriptPath, 'utf8');
  const declaredGlobals = [...globalsSource.matchAll(/\bvar\s+([^;\n]+);/g)]
    .flatMap((match) => match[1].split(',').map((name) => name.trim()))
    .sort();

  // Keep the Hermes compile declarations tied to real RN runtime bindings and
  // out of browser-only names that would hide a native environment mistake.
  const expectedGlobals = [
    'Blob',
    'FileReader',
    'FormData',
    'URL',
    'URLSearchParams',
    'XMLHttpRequest',
    'cancelAnimationFrame',
    'cancelIdleCallback',
    'clearImmediate',
    'clearTimeout',
    'console',
    'fetch',
    'nativeFabricUIManager',
    'performance',
    'Promise',
    'requestAnimationFrame',
    'requestIdleCallback',
    'setImmediate',
    'setTimeout',
  ].sort();
  assert.deepEqual(declaredGlobals, expectedGlobals);
  assert.match(
    xcodeScript,
    /-include-globals="\$REACT_NATIVE_DIR\/scripts\/orot-hermes-globals\.js"/,
  );
  assert.doesNotMatch(
    globalsSource,
    /\b(?:document|window|localStorage|sessionStorage|ResizeObserver|CSSStyleRule|Node)\b/,
  );
});
