#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <TargetConditionals.h>

@interface RCT_EXTERN_MODULE (OpenAIProviderModule, RCTEventEmitter)
RCT_EXTERN_METHOD(listModels : (NSString *)issuedClientID resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startResponse : (NSDictionary *)request requestId : (NSString *)
                      requestId issuedClientID : (NSString *)issuedClientID)
RCT_EXTERN_METHOD(cancelResponse : (NSString *)requestId)
#if DEBUG && TARGET_OS_SIMULATOR
RCT_EXTERN_METHOD(prepareSyntheticFixture : (NSString *)scenario resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(removeSyntheticFixture : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#endif
@end
