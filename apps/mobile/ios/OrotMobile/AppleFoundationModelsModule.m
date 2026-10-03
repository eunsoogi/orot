#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(AppleFoundationModelsModule, RCTEventEmitter)
RCT_EXTERN_METHOD(getAvailability:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(generate:(NSDictionary *)payload
                  requestId:(NSString *)requestId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startStream:(NSDictionary *)payload requestId:(NSString *)requestId)
RCT_EXTERN_METHOD(cancel:(NSString *)requestId)
@end
