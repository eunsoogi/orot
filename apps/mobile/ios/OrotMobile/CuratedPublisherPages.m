#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (CuratedPublisherPages, NSObject)
RCT_EXTERN_METHOD(load : (NSString *)url requestId : (NSString *)requestId resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel : (NSString *)requestId)
@end
