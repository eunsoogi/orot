#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <TargetConditionals.h>

@interface RCT_EXTERN_MODULE (RecordingModule, RCTEventEmitter)

RCT_EXTERN_METHOD(getState : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
RCT_EXTERN_METHOD(startRecording : (BOOL)acknowledged resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(pauseRecording : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(resumeRecording : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopRecording : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)
                      reject)
RCT_EXTERN_METHOD(playRecordingRange : (NSString *)recordingID startMs : (NSNumber *)
                      startMs endMs : (NSNumber *)endMs syntheticFixture : (BOOL)
                          syntheticFixture resolver : (RCTPromiseResolveBlock)
                              resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(installSyntheticTranscriptionFixture : (NSString *)base64 resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(removeSyntheticTranscriptionFixture : (NSString *)recordingID resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

#if DEBUG && TARGET_OS_SIMULATOR
RCT_EXTERN_METHOD(prepareSyntheticCapture : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prepareSyntheticStartFailure : (NSString *)point resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(simulateInterruption : (NSString *)phase resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#endif

@end
