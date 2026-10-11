#import <TargetConditionals.h>

// The Swift and Objective-C conditions must both be supplied by the dedicated probe build.
#if OROT_RECORDING_METERING_SIMULATOR_TEST && TARGET_OS_SIMULATOR
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
@interface RCT_EXTERN_MODULE (RecordingMeteringProbeModule, RCTEventEmitter)
RCT_EXTERN_METHOD(start : (BOOL)consent resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(pause : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(resume : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(finish : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getState : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
@end
#endif
