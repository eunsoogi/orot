#import <LocalAuthentication/LocalAuthentication.h>
#import <XCTest/XCTest.h>

// Use a separate context so the availability check cannot authenticate the Keychain query.
static inline void OrotAssertFaceIDAvailable(void) {
    LAContext *context = [LAContext new];
    NSError *availabilityError = nil;
    BOOL available = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                                          error:&availabilityError];
    if (!available) {
        XCTFail(@"The owner Simulator must have Face ID enrolled: %@", availabilityError);
        return;
    }
    if (context.biometryType != LABiometryTypeFaceID) {
        XCTFail(@"The focused authentication tests require Face ID");
        return;
    }
}
