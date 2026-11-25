export const eagerProvider = (
  names,
) => `@implementation RCTUnstableModulesRequiringMainQueueSetupProvider

+(NSArray<NSString *> *)modules
{
  return @[
    ${names.map((name) => '@"' + name + '"').join(',\n\t\t')}
  ];
}

@end
`;

export const eagerCore = [
  'AccessibilityManager',
  'Appearance',
  'AppState',
  'DeviceInfo',
  'PlatformConstants',
  'StatusBarManager',
];
