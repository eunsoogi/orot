#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (DailyReminderModule, NSObject)
RCT_EXTERN_METHOD(read : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(save : (NSDictionary *)value resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reconcile : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
@end
