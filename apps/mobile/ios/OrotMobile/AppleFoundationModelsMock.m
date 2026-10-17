#import <TargetConditionals.h>
#if OROT_TESTS && TARGET_OS_SIMULATOR
#import <React/RCTBridgeModule.h>

// Compile-time exclusion prevents launch arguments or preferences from enabling this endpoint in a
// shipped app.
@interface RCT_EXTERN_MODULE (OrotAppleModelMock, NSObject)
RCT_EXTERN_METHOD(configure : (NSDictionary *)value resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(enqueue : (NSDictionary *)value resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(observation : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
@end
#endif
