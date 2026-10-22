#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <RNKeychain/RNKeychainAuthentication.h>
#import <Security/Security.h>
#import <XCTest/XCTest.h>

@interface KeychainAuthenticationIntegrationTests : XCTestCase
@end

@implementation KeychainAuthenticationIntegrationTests

/// Verify RNKeychain's query contexts against an app-password-protected synthetic item.
- (void)testProtectedKeychainQueryAcceptsCredentialRejectsWrongCredentialAndDisallowsUi {
    NSString *service =
        [NSString stringWithFormat:@"com.orot.tests.keychain-auth.%@", NSUUID.UUID.UUIDString];
    NSString *account = @"protected-fixture";
    NSData *expectedData = [@"synthetic-keychain-value" dataUsingEncoding:NSUTF8StringEncoding];
    NSData *acceptedPassword = [@"synthetic-password" dataUsingEncoding:NSUTF8StringEncoding];
    CFErrorRef creationError = NULL;
    SecAccessControlRef accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAccessControlApplicationPassword, &creationError);
    if (accessControl == NULL) {
        NSString *details = creationError != NULL
                                ? CFBridgingRelease(CFErrorCopyDescription(creationError))
                                : @"No error details were returned";
        if (creationError != NULL) {
            CFRelease(creationError);
        }
        XCTFail(@"Could not create the synthetic access-control fixture: %@", details);
        return;
    }
    if (creationError != NULL) {
        CFRelease(creationError);
    }

    NSString *classKey = (__bridge NSString *)kSecClass;
    NSString *serviceKey = (__bridge NSString *)kSecAttrService;
    NSString *accountKey = (__bridge NSString *)kSecAttrAccount;
    NSString *accessControlKey = (__bridge NSString *)kSecAttrAccessControl;
    NSString *contextKey = (__bridge NSString *)kSecUseAuthenticationContext;
    NSString *dataKey = (__bridge NSString *)kSecValueData;
    NSString *returnDataKey = (__bridge NSString *)kSecReturnData;
    NSMutableDictionary *deleteQuery = [@{
        classKey : (__bridge id)kSecClassGenericPassword,
        serviceKey : service,
        accountKey : account,
    } mutableCopy];
    BOOL itemCreated = NO;
    CFTypeRef allowedResult = NULL;
    CFTypeRef deniedResult = NULL;
    CFTypeRef noUiResult = NULL;

    @try {
        NSMutableDictionary *addQuery = [@{
            classKey : (__bridge id)kSecClassGenericPassword,
            serviceKey : service,
            accountKey : account,
            accessControlKey : (__bridge id)accessControl,
            dataKey : expectedData,
        } mutableCopy];
        RNKeychainSetAuthenticationPrompt(addQuery, @"Create a synthetic protected fixture");
        LAContext *addContext = addQuery[contextKey];
        if (![addContext isKindOfClass:LAContext.class] ||
            ![addContext setCredential:acceptedPassword type:LACredentialTypeApplicationPassword]) {
            XCTFail(@"The RNKeychain helper must provide a credential-ready context for creation");
            return;
        }
        OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
        XCTAssertEqual(addStatus, (OSStatus)errSecSuccess,
                       @"The simulator must store the protected synthetic item");
        if (addStatus != errSecSuccess) {
            return;
        }
        itemCreated = YES;

        NSDictionary *queryBase = @{
            classKey : (__bridge id)kSecClassGenericPassword,
            serviceKey : service,
            accountKey : account,
            returnDataKey : @YES,
        };

        NSMutableDictionary *allowedQuery = [queryBase mutableCopy];
        RNKeychainSetAuthenticationPrompt(allowedQuery, @"Read a synthetic protected fixture");
        LAContext *allowedContext = allowedQuery[contextKey];
        if (![allowedContext isKindOfClass:LAContext.class] ||
            ![allowedContext setCredential:acceptedPassword
                                      type:LACredentialTypeApplicationPassword]) {
            XCTFail(@"The RNKeychain helper must provide a fresh context for an allowed read");
            return;
        }
        OSStatus allowedStatus =
            SecItemCopyMatching((__bridge CFDictionaryRef)allowedQuery, &allowedResult);
        XCTAssertEqual(allowedStatus, (OSStatus)errSecSuccess,
                       @"A matching application credential must read the item");
        XCTAssertEqualObjects((__bridge id)allowedResult, expectedData);

        NSMutableDictionary *deniedQuery = [queryBase mutableCopy];
        RNKeychainSetAuthenticationPrompt(deniedQuery, @"Reject a synthetic protected fixture");
        LAContext *deniedContext = deniedQuery[contextKey];
        NSData *incorrectPassword = [@"incorrect-password" dataUsingEncoding:NSUTF8StringEncoding];
        if (![deniedContext isKindOfClass:LAContext.class] ||
            ![deniedContext setCredential:incorrectPassword
                                     type:LACredentialTypeApplicationPassword]) {
            XCTFail(@"The RNKeychain helper must provide a fresh context for a denied read");
            return;
        }
        deniedContext.interactionNotAllowed = YES;
        OSStatus deniedStatus =
            SecItemCopyMatching((__bridge CFDictionaryRef)deniedQuery, &deniedResult);
        XCTAssertEqual(deniedStatus, (OSStatus)errSecAuthFailed,
                       @"A wrong credential must be denied without prompting");
        XCTAssertNil((__bridge id)deniedResult);

        NSMutableDictionary *noUiQuery = [queryBase mutableCopy];
        RNKeychainDisallowAuthenticationUI(noUiQuery);
        LAContext *noUiContext = noUiQuery[contextKey];
        if (![noUiContext isKindOfClass:LAContext.class] || !noUiContext.interactionNotAllowed) {
            XCTFail(@"The RNKeychain no-UI helper must provide a noninteractive context");
            return;
        }
        OSStatus noUiStatus = SecItemCopyMatching((__bridge CFDictionaryRef)noUiQuery, &noUiResult);
        XCTAssertEqual(noUiStatus, (OSStatus)errSecInteractionNotAllowed,
                       @"A protected lookup must remain noninteractive");
        XCTAssertNil((__bridge id)noUiResult);
    } @finally {
        if (allowedResult != NULL) {
            CFRelease(allowedResult);
        }
        if (deniedResult != NULL) {
            CFRelease(deniedResult);
        }
        if (noUiResult != NULL) {
            CFRelease(noUiResult);
        }
        if (itemCreated) {
            // Cleanup uses the same synthetic credential and forbids an interactive prompt.
            RNKeychainSetAuthenticationPrompt(deleteQuery, @"Delete a synthetic protected fixture");
            LAContext *deleteContext = deleteQuery[contextKey];
            if (![deleteContext isKindOfClass:LAContext.class] ||
                ![deleteContext setCredential:acceptedPassword
                                         type:LACredentialTypeApplicationPassword]) {
                XCTFail(@"The RNKeychain helper must provide a noninteractive cleanup context");
            } else {
                deleteContext.interactionNotAllowed = YES;
                OSStatus deleteStatus = SecItemDelete((__bridge CFDictionaryRef)deleteQuery);
                XCTAssertTrue(deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound,
                              @"The synthetic protected item must be removed after the test");
            }
        }
        CFRelease(accessControl);
    }
}

@end
