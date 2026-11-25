import { lstatSync, readFileSync } from "node:fs";

// RN 0.87.1 prebuilt iOS has these eager core modules but not RNTester's SampleTurboModule.
// After codegen, require the actual executable registry, not a comment or manifest.
const required = [
  "AccessibilityManager",
  "Appearance",
  "AppState",
  "DeviceInfo",
  "PlatformConstants",
  "StatusBarManager",
];

export function assertIosEagerModules(source) {
  const implementation = source.match(
    /^@implementation RCTUnstableModulesRequiringMainQueueSetupProvider\s+\+\(NSArray<NSString \*> \*\)modules\s*\{\s*return @\[([\s\S]*?)\];\s*\}\s*@end\s*$/m,
  );
  if (!implementation)
    throw new Error("Unexpected generated iOS eager module provider.");
  const names = implementation[1].split(",").map((entry) => {
    const parsed = entry.trim().match(/^@"(\w+)"$/);
    if (!parsed)
      throw new Error("Malformed generated iOS eager module registry.");
    return parsed[1];
  });
  const actual = new Set(names);
  if (
    actual.has("SampleTurboModule") ||
    required.some((name) => !actual.has(name))
  )
    throw new Error(
      "Generated iOS eager module registry does not match the prebuilt core.",
    );
}

export function verifyIosEagerModules(
  path = "apps/mobile/ios/build/generated/ios/ReactCodegen/RCTUnstableModulesRequiringMainQueueSetupProvider.mm",
) {
  if (!lstatSync(path).isFile())
    throw new Error("Expected a regular generated iOS eager module provider.");
  assertIosEagerModules(readFileSync(path, "utf8"));
}
