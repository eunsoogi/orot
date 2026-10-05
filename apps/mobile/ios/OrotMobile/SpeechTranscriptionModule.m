#import <React/RCTBridgeModule.h>

// React Native's Objective-C bridge shim exposes the Swift promise methods to JavaScript.
@interface RCT_EXTERN_MODULE (SpeechTranscriptionModule, NSObject)
RCT_EXTERN_METHOD(getAvailability : (NSString *)language resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(transcribeAudio : (NSDictionary *)request resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(transcribeRecording : (NSDictionary *)request resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
