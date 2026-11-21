// Synthetic output emitted only by the disposable Xcode stub. This follows the pinned
// generator shape, not a variable or bypass in the production build wrapper.
const template = `/*
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
{thirdPartyComponentsMapping}
    };
  });

  return thirdPartyComponents;
}

@end
`;

export const mapping = [
  '@"RNSScreen": NSClassFromString(@"RNSScreenView"), // react-native-screens',
  '@"RNSScreenStack": NSClassFromString(@"RNSScreenStackView"), // react-native-screens',
  '@"RNSScreenStackHeaderConfig": NSClassFromString(@"RNSScreenStackHeaderConfig"), // react-native-screens',
  '@"RNCSafeAreaProvider": NSClassFromString(@"RNCSafeAreaProviderComponentView"), // react-native-safe-area-context',
  '@"RNCSafeAreaView": NSClassFromString(@"RNCSafeAreaViewComponentView"), // react-native-safe-area-context',
];

export const provider = (entries = mapping) =>
  template.replace(
    '{thirdPartyComponentsMapping}',
    entries.map((line) => '      ' + line).join('\n'),
  );
