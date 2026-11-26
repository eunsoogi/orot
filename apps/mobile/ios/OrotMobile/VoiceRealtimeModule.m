#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <TargetConditionals.h>

@interface RCT_EXTERN_MODULE (VoiceRealtimeModule, RCTEventEmitter)
RCT_EXTERN_METHOD(openLiveCall : (NSString *)identifier model : (NSString *)model apiKey : (
    NSString *)apiKey options : (NSDictionary *)options resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reviewCanonicalLiveCall : (NSString *)identifier canonical : (
    NSDictionary *)canonical baseline : (NSDictionary *)baseline resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(retireCanonicalLiveReview : (NSString *)identifier resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(settleLiveResponsesToolCall : (NSString *)identifier challengeId : (NSString *)
                      challengeId output : (NSString *)output resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(claimLiveResponsesResult : (NSString *)
                                            identifier challengeId : (NSString *)challengeId)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(retireLiveResponsesResult : (NSString *)
                                            identifier challengeId : (NSString *)challengeId)
RCT_EXTERN_METHOD(revokeLiveResponsesGrant : (NSString *)grantID generation : (NSString *)
                      generation resolver : (RCTPromiseResolveBlock)
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
RCT_EXTERN_METHOD(settingsConsentCanonicalQueueProbe : (NSString *)
                      identifier scenario : (NSString *)scenario resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
#endif
RCT_EXTERN_METHOD(readLiveCommonConversationToolsWitness : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(claimLiveCommonConversationResult : (
    NSString *)call challengeId : (NSString *)challenge exactOutput : (NSString *)output)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(retireLiveCommonConversationResult : (NSString *)
                                            call challengeId : (NSString *)challenge)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(
    isLiveCommonConversationToolCurrent : (NSString *)call sessionId : (NSString *)
        session delegationId : (NSString *)delegation responseId : (NSString *)
            response challengeId : (NSString *)challenge toolCallId : (NSString *)function)
RCT_EXTERN_METHOD(settleLiveCommonConversationResult : (NSString *)call challengeId : (NSString *)
                      challenge output : (NSString *)output resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
