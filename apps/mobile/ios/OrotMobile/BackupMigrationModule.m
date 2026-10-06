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
@end
