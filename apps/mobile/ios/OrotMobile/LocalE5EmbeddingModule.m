#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (LocalE5EmbeddingModule, RCTEventEmitter)
RCT_EXTERN_METHOD(getModelIdentity : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getRuntimeMetrics : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prepare : (NSString *)requestId resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(embedBatch : (NSArray<NSString *> *)texts role : (NSString *)
                      role requestId : (NSString *)requestId resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel : (NSString *)requestId)
@end
