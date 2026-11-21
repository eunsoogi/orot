#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <TargetConditionals.h>

@interface RCT_EXTERN_MODULE (VoiceRealtimeModule, RCTEventEmitter)
RCT_EXTERN_METHOD(openLiveCall : (NSString *)identifier model : (NSString *)model apiKey : (
    NSString *)apiKey options : (NSDictionary *)options resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(closeLiveCall : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopRealtimeCall : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(interruptRealtimeOutput : (NSString *)identifier resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(pauseRealtimeCall : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(resumeRealtimeCall : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(resolveRealtimeToolCall : (NSString *)identifier toolCallId : (NSString *)
                      toolCallId responseId : (NSString *)responseId output : (NSString *)
                          output resolver : (RCTPromiseResolveBlock)
                              resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancelRealtimeTools : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#if defined(OROT_TESTS) && TARGET_OS_SIMULATOR
RCT_EXTERN_METHOD(settingsConsentSnapshot : (BOOL)lateEvent resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#endif
@end
