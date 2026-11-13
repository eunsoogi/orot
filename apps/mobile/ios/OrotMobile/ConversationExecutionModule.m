#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (ConversationExecutionModule, RCTEventEmitter)
RCT_EXTERN_METHOD(begin : (NSString *)requestId resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(end : (NSString *)requestId)
RCT_EXTERN_METHOD(isActive : (NSString *)requestId resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#if OROT_TESTS && TARGET_OS_SIMULATOR
RCT_EXTERN_METHOD(signalBackgroundCommit : (NSString *)requestId token : (NSString *)
                      token resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(signalBackgroundFailure : (NSString *)token)
#endif
RCT_EXTERN_METHOD(protectedDataAvailable : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
