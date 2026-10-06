#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (EventKitCalendarModule, RCTEventEmitter)
// Separate consent and listing so the unified coordinator can finish consent before reads.
RCT_EXTERN_METHOD(requestAccessIfNeeded : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(listUpcomingEvents : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(requestAccessAndListUpcomingEvents : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(findEvent : (NSString *)calendarEventIdentifier occurrenceDate : (
    NSString *_Nullable)occurrenceDate floatingOccurrenceAt : (NSString *_Nullable)
                      floatingOccurrenceAt resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
