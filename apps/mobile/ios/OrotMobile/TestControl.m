#if OROT_TESTS
#import <React/RCTBridgeModule.h>

// No module or command endpoint is exported by ordinary production builds.
@interface RCT_EXTERN_MODULE (OrotTestControl, NSObject)
RCT_EXTERN_METHOD(nextRequest : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
RCT_EXTERN_METHOD(complete : (NSString *)identifier result : (NSDictionary *)result)
RCT_EXTERN_METHOD(fail : (NSString *)identifier message : (NSString *)message)
RCT_EXTERN_METHOD(navigationSnapshot : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
#endif
