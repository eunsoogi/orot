import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

// These app-shell views always require Fabric descriptors, independent of the
// test profile. Do not pin the total count: unrelated installed views can vary.
const required = new Map([
  ['RNSScreen', ['RNSScreenView', 'react-native-screens']],
  ['RNSScreenStack', ['RNSScreenStackView', 'react-native-screens']],
  ['RNSScreenStackHeaderConfig', ['RNSScreenStackHeaderConfig', 'react-native-screens']],
  ['RNCSafeAreaProvider', ['RNCSafeAreaProviderComponentView', 'react-native-safe-area-context']],
  ['RNCSafeAreaView', ['RNCSafeAreaViewComponentView', 'react-native-safe-area-context']],
]);

// React Native 0.87.1's pinned provider template has one literal mapping slot.
// Match its complete executable envelope so a disabled or commented dictionary
// cannot certify the source that actually supplies the Fabric descriptors.
const generatedPrefix = `/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


#import <Foundation/Foundation.h>

#import "RCTThirdPartyComponentsProvider.h"
#import <React/RCTComponentViewProtocol.h>

@implementation RCTThirdPartyComponentsProvider

+ (NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *)thirdPartyFabricComponents
{
  static NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *thirdPartyComponents = nil;
  static dispatch_once_t nativeComponentsToken;

  dispatch_once(&nativeComponentsToken, ^{
    thirdPartyComponents = @{
`;
const generatedSuffix = `
    };
  });

  return thirdPartyComponents;
}

@end
`;

export function fabricRegistrationReceipt(source) {
  if (
    !source.startsWith(generatedPrefix) ||
    !source.endsWith(generatedSuffix) ||
    source.length < generatedPrefix.length + generatedSuffix.length
  )
    throw new Error('Unexpected generated Fabric provider structure.');
  const body = source.slice(generatedPrefix.length, -generatedSuffix.length);
  const seen = new Map();
  const entry = /^@"([\w]+)": NSClassFromString\(@"([\w.]+)"\), \/\/ ([\w@/.-]+)$/;
  for (const line of body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)) {
    const parsed = entry.exec(line);
    if (!parsed) throw new Error('Malformed Fabric registration.');
    const [, component, nativeClass, owner] = parsed;
    if (seen.has(component)) throw new Error('Duplicate Fabric registration.');
    seen.set(component, [nativeClass, owner]);
  }
  if (!seen.size) throw new Error('Empty Fabric registration dictionary.');
  for (const [component, [nativeClass, owner]] of required) {
    const found = seen.get(component);
    if (found?.[0] !== nativeClass || found?.[1] !== owner)
      throw new Error(`Missing or invalid required Fabric registration: ${component}.`);
  }
  return {
    count: seen.size,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
}

export function verifyIosFabricProvider(
  path = 'apps/mobile/ios/build/generated/ios/ReactCodegen/RCTThirdPartyComponentsProvider.mm',
) {
  if (!lstatSync(path).isFile())
    throw new Error('Expected a regular generated iOS Fabric provider file.');
  const receipt = fabricRegistrationReceipt(readFileSync(path, 'utf8'));
  console.log(`Verified iOS Fabric registrations: ${receipt.count}; SHA-256: ${receipt.sha256}`);
  return receipt;
}
