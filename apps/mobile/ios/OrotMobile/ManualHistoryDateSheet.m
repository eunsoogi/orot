#import <React/RCTViewManager.h>

// The mounted view supplies the presentation window and returns only a committed date.
@interface RCT_EXTERN_MODULE (ManualHistoryDateSheetAnchorManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(request, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(onResult, RCTDirectEventBlock)
@end
