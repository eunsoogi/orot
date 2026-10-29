import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const appRequire = createRequire(resolve('apps/mobile/package.json'));
const nativeRequire = createRequire(appRequire.resolve('react-native/package.json'));
const codegenRequire = createRequire(nativeRequire.resolve('@react-native/codegen/package.json'));
const generateStateCpp = codegenRequire('./lib/generators/components/GenerateStateCpp');
const generateShadowNodeCpp = codegenRequire('./lib/generators/components/GenerateShadowNodeCpp');
const keychainPackagePath = appRequire.resolve('react-native-keychain/package.json');
const keychainRoot = dirname(keychainPackagePath);
const keychainManifest = JSON.parse(readFileSync(keychainPackagePath, 'utf8'));
const keychainNativeSpecs = readdirSync(resolve(keychainRoot, 'src')).filter((name) =>
  /^Native.+\.(?:ts|tsx)$/.test(name),
);
const safeAreaPackagePath = appRequire.resolve('react-native-safe-area-context/package.json');
const safeAreaRoot = dirname(safeAreaPackagePath);

// The pinned state template emits no implementation for this component.
test('Codegen omits empty States.cpp translation units', () => {
  const generatedFiles = generateStateCpp.generate(
    'RNSafeAreaContext',
    {
      modules: {
        RNSafeAreaContext: {
          type: 'Component',
          components: {
            RNCSafeAreaView: { interfaceOnly: false },
          },
        },
      },
    },
    'com.example',
  );

  assert.deepEqual([...generatedFiles.keys()], []);
});

// Slider and DateTimePicker have no exported component-name definitions in this generated unit.
test('Codegen omits empty ShadowNodes.cpp files and retains exported component names', () => {
  const emptyFiles = generateShadowNodeCpp.generate(
    'RNCSlider',
    {
      modules: {
        RNCSlider: { type: 'Component', components: {} },
        RNDateTimePicker: { type: 'Component', components: {} },
      },
    },
    'com.example',
  );
  assert.deepEqual([...emptyFiles.keys()], []);

  const populatedFiles = generateShadowNodeCpp.generate(
    'safeareacontext',
    {
      modules: {
        safeareacontext: {
          type: 'Component',
          components: {
            RNCSafeAreaProvider: { interfaceOnly: false },
            RNCSafeAreaView: { interfaceOnly: false },
          },
        },
      },
    },
    'com.example',
  );
  assert.deepEqual([...populatedFiles.keys()], ['ShadowNodes.cpp']);
  assert.match(populatedFiles.get('ShadowNodes.cpp'), /RNCSafeAreaProviderComponentName/);
  assert.match(populatedFiles.get('ShadowNodes.cpp'), /RNCSafeAreaViewComponentName/);
});

// v10.0.0 has no Native* Codegen spec; its old registration generated empty module outputs.
test('Keychain keeps its bridge entrypoint without registering empty Codegen specs', () => {
  assert.equal(keychainManifest.version, '10.0.0');
  assert.deepEqual(keychainNativeSpecs, []);
  assert.equal(keychainManifest.codegenConfig, undefined);
  assert.match(readFileSync(resolve(keychainRoot, 'src/index.ts'), 'utf8'), /\bNativeModules\b/);
});

// The excluded state file is Android-only, while the iOS event initializer must
// follow its generated field order to avoid producing an empty object or reorder warning.
test('safe-area iOS pod excludes Android state and orders event inset fields', () => {
  const podspec = readFileSync(
    resolve(safeAreaRoot, 'react-native-safe-area-context.podspec'),
    'utf8',
  );
  const source = readFileSync(
    resolve(safeAreaRoot, 'ios/Fabric/RNCSafeAreaProviderComponentView.mm'),
    'utf8',
  );
  const initializer = source.match(/\.insets\s*=\s*\{([\s\S]*?)\n\s*\},\s*\.frame\s*=/);

  assert.match(
    podspec,
    /ss\.exclude_files\s*=\s*"common\/cpp\/react\/renderer\/components\/safeareacontext\/RNCSafeAreaViewState\.cpp"/,
  );
  assert.ok(initializer, 'The safe-area inset initializer must remain present');
  assert.deepEqual(
    [...initializer[1].matchAll(/\.(top|right|bottom|left)\s*=/g)].map((match) => match[1]),
    ['top', 'right', 'bottom', 'left'],
  );
});
