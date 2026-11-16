#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (CalendarDecisionsTransport, NSObject)
RCT_EXTERN_METHOD(post : (NSString *)body apiKey : (NSString *)apiKey requestId : (NSString *)
                      requestId resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel : (NSString *)requestId)
@end
