#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (VoiceRealtimeModule, RCTEventEmitter)
RCT_EXTERN_METHOD(openRealtimeCall : (NSString *)identifier model : (NSString *)model apiKey : (
    NSString *)apiKey language : (NSString *)language enableTools : (BOOL)enableTools resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopRealtimeCall : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(interruptRealtimeOutput : (NSString *)identifier resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(pauseRealtimeCall : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(resumeRealtimeCall : (NSString *)identifier resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(resolveRealtimeToolCall : (NSString *)identifier toolCallId : (NSString *)toolCallId
                  responseId : (NSString *)responseId output : (NSString *)output
                  resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancelRealtimeTools : (NSString *)identifier resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
