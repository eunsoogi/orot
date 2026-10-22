#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <RNKeychain/RNKeychainAuthentication.h>
#import <Security/Security.h>
#import <XCTest/XCTest.h>

@interface KeychainAuthenticationIntegrationTests : XCTestCase
@end

@implementation KeychainAuthenticationIntegrationTests

/// Run as the documented focused selection because it requires Simulator Face ID input.
- (void)testProtectedKeychainReadUsesPromptedContextAfterBiometricMatch {
    NSString *service = [NSString
        stringWithFormat:@"com.orot.tests.keychain-auth.interactive.%@", NSUUID.UUID.UUIDString];
    NSString *account = @"synthetic-biometric-fixture";
    NSData *expectedData =
        [@"synthetic-biometric-keychain-value" dataUsingEncoding:NSUTF8StringEncoding];
    CFErrorRef accessError = NULL;
    SecAccessControlRef accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAccessControlBiometryAny, &accessError);
    if (accessControl == NULL) {
        NSString *details = accessError != NULL
                                ? CFBridgingRelease(CFErrorCopyDescription(accessError))
                                : @"No error details were returned";
        if (accessError != NULL) {
            CFRelease(accessError);
        }
        XCTFail(@"Could not create the synthetic biometric fixture: %@", details);
        return;
    }
    if (accessError != NULL) {
        CFRelease(accessError);
    }

    NSString *classKey = (__bridge NSString *)kSecClass;
    NSString *serviceKey = (__bridge NSString *)kSecAttrService;
    NSString *accountKey = (__bridge NSString *)kSecAttrAccount;
    NSString *accessControlKey = (__bridge NSString *)kSecAttrAccessControl;
    NSString *dataKey = (__bridge NSString *)kSecValueData;
    NSString *returnDataKey = (__bridge NSString *)kSecReturnData;
    NSString *contextKey = (__bridge NSString *)kSecUseAuthenticationContext;
    NSMutableDictionary *deleteQuery = [@{
        classKey : (__bridge id)kSecClassGenericPassword,
        serviceKey : service,
        accountKey : account,
    } mutableCopy];
    BOOL itemCreated = NO;
    CFTypeRef result = NULL;

    @try {
        NSMutableDictionary *addQuery = [@{
            classKey : (__bridge id)kSecClassGenericPassword,
            serviceKey : service,
            accountKey : account,
            accessControlKey : (__bridge id)accessControl,
            dataKey : expectedData,
        } mutableCopy];
        OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
        XCTAssertEqual(addStatus, (OSStatus)errSecSuccess,
                       @"The Simulator must store the synthetic biometric item");
        if (addStatus != errSecSuccess) {
            return;
        }
        itemCreated = YES;

        NSMutableDictionary *readQuery = [@{
            classKey : (__bridge id)kSecClassGenericPassword,
            serviceKey : service,
            accountKey : account,
            returnDataKey : @YES,
        } mutableCopy];
        RNKeychainSetAuthenticationPrompt(readQuery, @"Read a synthetic Keychain fixture");
        LAContext *context = readQuery[contextKey];
        XCTAssertTrue([context isKindOfClass:LAContext.class]);
        XCTAssertEqualObjects(context.localizedReason, @"Read a synthetic Keychain fixture");
        XCTAssertFalse(context.interactionNotAllowed);

        OSStatus readStatus = SecItemCopyMatching((__bridge CFDictionaryRef)readQuery, &result);
        XCTAssertEqual(readStatus, (OSStatus)errSecSuccess,
                       @"A matching Simulator biometric must permit the protected query");
        XCTAssertEqualObjects((__bridge id)result, expectedData);
    } @finally {
        if (result != NULL) {
            CFRelease(result);
        }
        if (itemCreated) {
            RNKeychainDisallowAuthenticationUI(deleteQuery);
            OSStatus deleteStatus = SecItemDelete((__bridge CFDictionaryRef)deleteQuery);
            // A protected item may refuse deletion without a second user action. Its unique
            // fixture remains inside the owner Simulator, which the test helper retires.
            XCTAssertTrue(
                deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound ||
                    deleteStatus == errSecInteractionNotAllowed,
                @"Protected fixture cleanup must succeed or stay inside the owner Simulator");
        }
        CFRelease(accessControl);
    }
}

/// Exercise the prompted query context and the protected-query no-UI result using synthetic
/// Keychain items.
- (void)testKeychainQueryUsesFreshContextAndBlocksProtectedLookupWithoutUi {
    NSString *servicePrefix =
        [NSString stringWithFormat:@"com.orot.tests.keychain-auth.%@", NSUUID.UUID.UUIDString];
    NSString *account = @"synthetic-fixture";
    NSData *expectedData = [@"synthetic-keychain-value" dataUsingEncoding:NSUTF8StringEncoding];
    CFErrorRef accessError = NULL;
    // The Simulator accepted a user-presence-only item without interaction. Requiring biometrics
    // matches the prompted case and keeps the no-UI assertion on an authentication-gated item.
    SecAccessControlRef accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAccessControlBiometryAny, &accessError);
    if (accessControl == NULL) {
        NSString *details = accessError != NULL
                                ? CFBridgingRelease(CFErrorCopyDescription(accessError))
                                : @"No error details were returned";
        if (accessError != NULL) {
            CFRelease(accessError);
        }
        XCTFail(@"Could not create the synthetic biometric fixture: %@", details);
        return;
    }
    if (accessError != NULL) {
        CFRelease(accessError);
    }

    NSString *classKey = (__bridge NSString *)kSecClass;
    NSString *serviceKey = (__bridge NSString *)kSecAttrService;
    NSString *accountKey = (__bridge NSString *)kSecAttrAccount;
    NSString *accessControlKey = (__bridge NSString *)kSecAttrAccessControl;
    NSString *contextKey = (__bridge NSString *)kSecUseAuthenticationContext;
    NSString *dataKey = (__bridge NSString *)kSecValueData;
    NSString *returnDataKey = (__bridge NSString *)kSecReturnData;
    NSMutableDictionary *plainDeleteQuery = [@{
        classKey : (__bridge id)kSecClassGenericPassword,
        serviceKey : [servicePrefix stringByAppendingString:@".plain"],
        accountKey : account,
    } mutableCopy];
    NSMutableDictionary *protectedDeleteQuery = [@{
        classKey : (__bridge id)kSecClassGenericPassword,
        serviceKey : [servicePrefix stringByAppendingString:@".protected"],
        accountKey : account,
    } mutableCopy];
    BOOL plainItemCreated = NO;
    BOOL protectedItemCreated = NO;
    CFTypeRef plainResult = NULL;
    CFTypeRef protectedResult = NULL;

    @try {
        NSMutableDictionary *plainAddQuery = [@{
            classKey : (__bridge id)kSecClassGenericPassword,
            serviceKey : plainDeleteQuery[serviceKey],
            accountKey : account,
            dataKey : expectedData,
        } mutableCopy];
        OSStatus plainAddStatus = SecItemAdd((__bridge CFDictionaryRef)plainAddQuery, NULL);
        XCTAssertEqual(plainAddStatus, (OSStatus)errSecSuccess,
                       @"The simulator must store the unprotected synthetic item");
        if (plainAddStatus != errSecSuccess) {
            return;
        }
        plainItemCreated = YES;

        NSDictionary *readBase = @{
            classKey : (__bridge id)kSecClassGenericPassword,
            serviceKey : plainDeleteQuery[serviceKey],
            accountKey : account,
            returnDataKey : @YES,
        };
        NSMutableDictionary *plainReadQuery = [readBase mutableCopy];
        RNKeychainSetAuthenticationPrompt(plainReadQuery, @"Read a synthetic Keychain fixture");
        LAContext *plainReadContext = plainReadQuery[contextKey];
        XCTAssertTrue([plainReadContext isKindOfClass:LAContext.class]);
        XCTAssertEqualObjects(plainReadContext.localizedReason,
                              @"Read a synthetic Keychain fixture");
        XCTAssertFalse(plainReadContext.interactionNotAllowed);
        OSStatus plainReadStatus =
            SecItemCopyMatching((__bridge CFDictionaryRef)plainReadQuery, &plainResult);
        XCTAssertEqual(plainReadStatus, (OSStatus)errSecSuccess,
                       @"A normal Keychain query must accept its authentication context");
        XCTAssertEqualObjects((__bridge id)plainResult, expectedData);

        NSMutableDictionary *protectedAddQuery = [@{
            classKey : (__bridge id)kSecClassGenericPassword,
            serviceKey : protectedDeleteQuery[serviceKey],
            accountKey : account,
            accessControlKey : (__bridge id)accessControl,
            dataKey : expectedData,
        } mutableCopy];
        OSStatus protectedAddStatus = SecItemAdd((__bridge CFDictionaryRef)protectedAddQuery, NULL);
        XCTAssertEqual(protectedAddStatus, (OSStatus)errSecSuccess,
                       @"The simulator must store the synthetic biometric item");
        if (protectedAddStatus != errSecSuccess) {
            return;
        }
        protectedItemCreated = YES;

        NSMutableDictionary *protectedReadQuery = [readBase mutableCopy];
        protectedReadQuery[serviceKey] = protectedDeleteQuery[serviceKey];
        RNKeychainDisallowAuthenticationUI(protectedReadQuery);
        LAContext *noUiContext = protectedReadQuery[contextKey];
        XCTAssertTrue([noUiContext isKindOfClass:LAContext.class]);
        XCTAssertTrue(noUiContext.interactionNotAllowed);
        XCTAssertNotEqual(
            plainReadContext, noUiContext,
            @"Each Keychain query must receive an independent authentication context");
        OSStatus protectedReadStatus =
            SecItemCopyMatching((__bridge CFDictionaryRef)protectedReadQuery, &protectedResult);
        XCTAssertEqual(protectedReadStatus, (OSStatus)errSecInteractionNotAllowed,
                       @"A protected lookup must preserve the no-UI failure status");
        XCTAssertNil((__bridge id)protectedResult);
    } @finally {
        if (plainResult != NULL) {
            CFRelease(plainResult);
        }
        if (protectedResult != NULL) {
            CFRelease(protectedResult);
        }
        if (plainItemCreated) {
            OSStatus deleteStatus = SecItemDelete((__bridge CFDictionaryRef)plainDeleteQuery);
            XCTAssertTrue(deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound,
                          @"The unprotected synthetic item must be removed after the test");
        }
        if (protectedItemCreated) {
            RNKeychainDisallowAuthenticationUI(protectedDeleteQuery);
            OSStatus deleteStatus = SecItemDelete((__bridge CFDictionaryRef)protectedDeleteQuery);
            // Biometric protection can also forbid cleanup without authentication. The unique
            // fixture is isolated to this owner simulator, which the test helper retires afterward.
            XCTAssertTrue(
                deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound ||
                    deleteStatus == errSecInteractionNotAllowed,
                @"Protected fixture cleanup must succeed or stay inside the owner simulator");
        }
        CFRelease(accessControl);
    }
}

@end
