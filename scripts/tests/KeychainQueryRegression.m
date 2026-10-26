// Inspect the modern authentication query against the host LocalAuthentication framework.
// This checks request construction, not biometric or device authentication.
#import "RNKeychainAuthentication.h"

int main(void) {
    @autoreleasepool {
        NSString *contextKey = (__bridge NSString *)kSecUseAuthenticationContext;
        NSMutableDictionary *first = [@{@"service" : @"synthetic-service"} mutableCopy];
        NSMutableDictionary *second = [NSMutableDictionary new];
        RNKeychainSetAuthenticationPrompt(first, @"Read the synthetic fixture");
        RNKeychainSetAuthenticationPrompt(second, @"Read another fixture");
        LAContext *firstContext = first[contextKey];
        LAContext *secondContext = second[contextKey];
        BOOL passed =
            [firstContext isKindOfClass:[LAContext class]] &&
            [secondContext isKindOfClass:[LAContext class]] && firstContext != secondContext &&
            [firstContext.localizedReason isEqualToString:@"Read the synthetic fixture"] &&
            [secondContext.localizedReason isEqualToString:@"Read another fixture"] &&
            [first[@"service"] isEqualToString:@"synthetic-service"] &&
            !firstContext.interactionNotAllowed;
        NSMutableDictionary *existence = [NSMutableDictionary new];
        RNKeychainDisallowAuthenticationUI(existence);
        LAContext *existenceContext = existence[contextKey];
        passed = passed && [existenceContext isKindOfClass:[LAContext class]] &&
                 existenceContext.interactionNotAllowed && existenceContext != firstContext &&
                 existenceContext != secondContext;

        printf("keychain-fresh-contexts-and-prompt=%s\n", passed ? "pass" : "fail");
        return passed ? 0 : 1;
    }
}
