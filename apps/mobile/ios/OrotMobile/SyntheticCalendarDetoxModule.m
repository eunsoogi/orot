#import <TargetConditionals.h>

#if defined(OROT_CALENDAR_DETOX) && TARGET_OS_SIMULATOR
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(SyntheticCalendarDetoxModule, RCTEventEmitter)
RCT_EXTERN_METHOD(requestAccessAndListUpcomingEvents:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(findEvent:(NSString *)calendarEventIdentifier
                  occurrenceDate:(NSString * _Nullable)occurrenceDate
                  floatingOccurrenceAt:(NSString * _Nullable)floatingOccurrenceAt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
@end
#endif
