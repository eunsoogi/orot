import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const appRequire = createRequire(resolve('apps/mobile/package.json'));
const screensPackagePath = appRequire.resolve('react-native-screens/package.json');
const screensRoot = dirname(screensPackagePath);
const screensManifest = JSON.parse(readFileSync(screensPackagePath, 'utf8'));
const screensPodspec = readFileSync(resolve(screensRoot, 'RNScreens.podspec'), 'utf8');
const androidStatePath =
  'common/cpp/react/renderer/components/rnscreens/RNSScreenStackHeaderSubviewState.cpp';
const androidStateSource = readFileSync(resolve(screensRoot, androidStatePath), 'utf8');
const categoryOnlySources = [
  'ios/utils/NSString+RNSUtility.mm',
  'ios/tabs/RCTConvert+RNSTabs.mm',
  'ios/utils/RCTSurfaceTouchHandler+RNSUtility.mm',
  'ios/utils/UINavigationBar+RNSUtility.mm',
  'ios/UIScrollView+RNScreens.mm',
  'ios/RCTImageComponentView+RNSScreenStackHeaderConfig.mm',
  'ios/tabs/extensions/RNSTabsHostComponentView+RNSImageLoader.mm',
  'ios/utils/UIView+RNSUtility.mm',
  'ios/UIWindow+RNScreens.mm',
];

// This implementation is Android-only; listing it in the iOS pod creates an empty archive member.
test('RNScreens excludes its Android-only state implementation from the iOS pod', () => {
  assert.equal(screensManifest.version, '4.27.0');
  assert.match(
    androidStateSource,
    /#ifdef ANDROID[\s\S]*RNSScreenStackHeaderSubviewState::getDynamic[\s\S]*#endif \/\/ ANDROID/,
  );
  assert.match(
    screensPodspec,
    /ss\.exclude_files\s*=\s*\[[\s\S]*?"common\/cpp\/react\/renderer\/components\/rnscreens\/RNSScreenStackHeaderSubviewState\.cpp"/,
  );
});

test('category-only archive objects expose only hidden libtool anchors', () => {
  for (const path of categoryOnlySources) {
    const source = readFileSync(resolve(screensRoot, path), 'utf8');

    assert.match(source, /@implementation\s+\w+\s*\(/, path);
    assert.match(
      source,
      /__attribute__\(\(visibility\("hidden"\)\)\) void RNScreensArchiveAnchor_\w+\(void\) \{\}/,
      path,
    );
  }
});
