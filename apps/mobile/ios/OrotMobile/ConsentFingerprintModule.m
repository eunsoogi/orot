#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (OrotConsentFingerprint, NSObject)
RCT_EXTERN_METHOD(sha256 : (NSString *)text resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
