#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <TargetConditionals.h>

@interface RCT_EXTERN_MODULE (HealthKitModule, RCTEventEmitter)
RCT_EXTERN_METHOD(setWorkoutChangeObservation : (BOOL)enabled)
RCT_EXTERN_METHOD(getAvailability : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(requestReadAuthorization : (NSString *)feature resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(requestReadAuthorizations : (NSArray<NSString *> *)features resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(querySamples : (NSDictionary *)query resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(queryWorkoutHeartRate : (NSString *)workoutID resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(queryWorkoutPeriodHeartRate : (NSDictionary *)request resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancelWorkoutPeriodHeartRate : (NSString *)callId)
RCT_EXTERN_METHOD(queryMedicationDefinitions : (nonnull NSNumber *)limit resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(querySampleChanges : (NSDictionary *)query resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#if DEBUG && TARGET_OS_SIMULATOR
RCT_EXTERN_METHOD(prepareSyntheticFixture : (NSString *)feature resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prepareSyntheticFixtures : (NSArray<NSString *> *)features resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(removeSyntheticFixture : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(inspectReadAuthorizationPlan : (NSString *)feature resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(inspectBatchAuthorizationPlan : (NSArray<NSString *> *)features resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(inspectSampleType : (NSString *)feature sampleKind : (NSString *)
                      sampleKind resolver : (RCTPromiseResolveBlock)
                          resolve rejecter : (RCTPromiseRejectBlock)reject)
#endif
@end
