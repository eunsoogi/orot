#if OROT_TESTS
#import <TargetConditionals.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// No module or command endpoint is exported by ordinary production builds.
@interface RCT_EXTERN_MODULE (OrotTestControl, RCTEventEmitter)
RCT_EXTERN_METHOD(nextRequest : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
RCT_EXTERN_METHOD(complete : (NSString *)identifier result : (NSDictionary *)result)
RCT_EXTERN_METHOD(fail : (NSString *)identifier message : (NSString *)message)
RCT_EXTERN_METHOD(enqueueSyntheticReply : (NSDictionary *)input resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(recordObservation : (NSDictionary *)observation)
#if TARGET_OS_SIMULATOR
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(activeTabEvent : (NSString *)event)
#endif
RCT_EXTERN_METHOD(speechSnapshot : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(refreshAppearance : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(navigationSnapshot : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(rotationGeometryCommand : (NSString *)session mode : (NSString *)mode resolve : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
#endif
