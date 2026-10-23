// The generated include is the installed dependency's actual option function.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import "KeychainAccessibility.inc"

#ifdef PROBE_ADJACENT_DEPRECATION
// This adjacent legacy use must still fail when deprecation warnings are errors.
CFStringRef adjacentDeprecatedUse(void) { return kSecAttrAccessibleAlways; }
#endif

int main(void) {
    @autoreleasepool {
        CFStringRef actual = accessibleValue(@{@"accessible" : @"AccessibleAlways"});
        // The expected value is the real SDK symbol. Only this test comparison
        // needs the same legacy reference; the adjacent probe remains outside.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        BOOL passed = CFEqual(actual, kSecAttrAccessibleAlways);
#pragma clang diagnostic pop
        passed = passed && CFEqual(accessibleValue(@{@"accessible" : @"AccessibleWhenUnlocked"}),
                                   kSecAttrAccessibleWhenUnlocked);
        printf("keychain-accessibility-values=%s\n", passed ? "pass" : "fail");
        return passed ? 0 : 1;
    }
}
