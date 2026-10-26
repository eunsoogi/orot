#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (MedicalDocumentImportModule, NSObject)
RCT_EXTERN_METHOD(pickMedicalDocument : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(discardMedicalDocument : (NSString *)sourceID resolver : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reconcileMedicalDocumentFiles : (NSArray<NSString *> *)sourceIDs resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stageMedicalDocumentDeletion : (NSString *)sourceID resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(restoreMedicalDocumentDeletion : (NSString *)sourceID resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(commitMedicalDocumentDeletion : (NSString *)sourceID resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
@end
