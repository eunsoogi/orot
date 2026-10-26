#if OROT_TESTS
#import <React/RCTBridgeModule.h>

// Ordinary app products export neither the observer nor a notification mutation endpoint.
@interface RCT_EXTERN_MODULE (OrotReminderTestObservation, NSObject)
RCT_EXTERN_METHOD(snapshot : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
@end
#endif
