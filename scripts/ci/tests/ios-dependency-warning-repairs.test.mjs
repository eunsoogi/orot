import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Read the exact pinned dependency sources installed by pnpm to guard iOS warning repairs.
const appRequire = createRequire(resolve('apps/mobile/package.json'));
const sliderRoot = dirname(appRequire.resolve('@react-native-community/slider/package.json'));
const dateTimePickerRoot = dirname(
  appRequire.resolve('@react-native-community/datetimepicker/package.json'),
);
const reactNativeRoot = dirname(appRequire.resolve('react-native/package.json'));

function source(root, path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('Slider keeps its final-image and quantization contracts with valid iOS inputs', () => {
  const component = source(sliderRoot, 'ios/RNCSliderComponentView.mm');
  const componentHeader = source(sliderRoot, 'ios/RNCSliderComponentView.h');
  const sliderHeader = source(sliderRoot, 'ios/RNCSlider.h');
  const sliderImplementation = source(sliderRoot, 'ios/RNCSlider.m');
  const podspec = source(sliderRoot, 'react-native-slider.podspec');
  const imageLoaderCall = component.match(/\[imageLoader[\s\S]*?\];/);

  assert.ok(imageLoaderCall, 'The Fabric slider must keep the React Native image-loader path');
  assert.match(
    imageLoaderCall[0],
    /progressBlock:\^\(__unused int64_t progress, __unused int64_t total\) \{\}/,
  );
  assert.match(imageLoaderCall[0], /partialLoadBlock:\^\(__unused UIImage \*image\) \{\}/);
  assert.match(imageLoaderCall[0], /completionBlock:\^\(NSError \*error, UIImage \*image\)/);
  assert.match(imageLoaderCall[0], /completionBlock\(nil, image\)/);
  assert.doesNotMatch(componentHeader, /-\s*\(float\)\s*discreteValue:/);
  assert.match(sliderHeader, /-\s*\(float\)\s*discreteValue:\s*\(float\)value/);
  assert.match(sliderImplementation, /-\s*\(float\)discreteValue:\s*\(float\)value/);
  assert.match(component, /\[slider discreteValue:/);
  assert.match(
    podspec,
    /ss\.exclude_files\s*=\s*"common\/cpp\/react\/renderer\/components\/RNCSlider\/RNCSliderMeasurementsManager\.cpp"/,
  );
});

test('DateTimePicker retains its style converters and excludes deprecated or empty inputs', () => {
  const stateHeader = source(
    dateTimePickerRoot,
    'ios/fabric/cpp/react/renderer/components/RNDateTimePicker/RNDateTimePickerState.h',
  );
  const stateSource = source(
    dateTimePickerRoot,
    'ios/fabric/cpp/react/renderer/components/RNDateTimePicker/RNDateTimePickerState.cpp',
  );
  const manager = source(dateTimePickerRoot, 'ios/RNDateTimePickerManager.m');
  const podspec = source(dateTimePickerRoot, 'RNDateTimePicker.podspec');
  const reactConverter = source(reactNativeRoot, 'React/Base/RCTConvert.mm');

  assert.match(stateHeader, /#include <react\/renderer\/graphics\/Size\.h>/);
  assert.doesNotMatch(stateHeader, /Geometry\.h/);
  assert.match(stateHeader, /Size frameSize\{\}/);
  assert.match(stateSource, /namespace facebook[\s\S]*namespace react[\s\S]*\{\s*\}/);
  assert.match(
    podspec,
    /if ENV\['RCT_NEW_ARCH_ENABLED'\] == '1'[\s\S]*?s\.exclude_files\s*=\s*"ios\/fabric\/cpp\/react\/renderer\/components\/RNDateTimePicker\/RNDateTimePickerState\.cpp"/,
  );

  assert.match(manager, /RCT_ENUM_CONVERTER\(UIDatePickerMode/);
  assert.match(manager, /RCT_ENUM_CONVERTER\(RNCUIDatePickerStyle/);
  assert.match(manager, /RCT_EXPORT_MODULE\(\)/);
  assert.doesNotMatch(manager, /RCT_ENUM_CONVERTER\(\s*UIUserInterfaceStyle/);
  for (const style of ['auto', 'unspecified', 'light', 'dark']) {
    assert.match(reactConverter, new RegExp(`@"${style}"\\s*:\\s*@\\(UIUserInterfaceStyle`));
  }
});
