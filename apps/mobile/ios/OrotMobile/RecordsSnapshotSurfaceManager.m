#import <React/RCTComponent.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(RecordsSnapshotSurfaceManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(presentationGeneration, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(onRecordsCoverage, RCTDirectEventBlock)
@end
