#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (BackupMigrationModule, NSObject)
RCT_EXTERN_METHOD(migrateDatabaseKeyForBackup : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isDatabaseKeyBackupEligible : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(databaseFileState : (NSString *)name location : (NSString *)location resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prepareRecordingsForBackup : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#if OROT_BACKUP_PROBE_TEST
RCT_EXTERN_METHOD(armPostUpdateReadbackFailureForProbe : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(postUpdateReadbackFailureWasTriggeredForProbe : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prepareLegacyRecordingForBackupProbe : (NSString *)recordingId resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(inspectRecordingForBackupProbe : (NSString *)recordingId resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(backupKeyAccessibilityForProbe : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject)
#endif
@end
