#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>
#import <UIKit/UIKit.h>

// React owns history text and actions; the native table emits row selection and deletion
// identities.
@interface RCT_EXTERN_MODULE (ConversationHistoryViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(rows, NSArray)
RCT_EXPORT_VIEW_PROPERTY(onSelectSession, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onDeleteSession, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onContentHeightChange, RCTDirectEventBlock)
@end

// The composer owns input and actions in React; this view supplies only native material.
@interface RCT_EXTERN_MODULE (ComposerGlassViewManager, RCTViewManager)
@end

// UIKit owns the Send/Stop target; the adjacent ComposerGlassView supplies the field material.
@interface RCT_EXTERN_MODULE (ComposerGlassActionViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(busy, BOOL)
RCT_EXPORT_VIEW_PROPERTY(disabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(actionLabel, NSString)
RCT_EXPORT_VIEW_PROPERTY(actionTestID, NSString)
RCT_EXPORT_VIEW_PROPERTY(onComposerPress, RCTDirectEventBlock)
@end

// Register the Swift view manager with React Native's UIKit view registry.
@interface RCT_EXTERN_MODULE (NavigationGlassViewManager, RCTViewManager)
// Keep measured rail placement with action descriptors so UIKit can move
// existing controls in place.
RCT_EXPORT_VIEW_PROPERTY(actions, NSArray)
// Page controls share the lane but never replace navigation's measured frame.
RCT_EXPORT_VIEW_PROPERTY(isPageDock, BOOL)
RCT_EXPORT_VIEW_PROPERTY(pageMetricsRequest, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(onPageMetrics, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onAction, RCTBubblingEventBlock)
// A committed React overlay move requests fresh UIKit measurement without supplying a navigation
// frame.
RCT_EXPORT_VIEW_PROPERTY(geometryLayoutRevision, NSString)
RCT_EXPORT_VIEW_PROPERTY(layoutMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(railTopInset, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(railBottomInset, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(railRightInset, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(railAvailableHeight, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(bottomHeight, CGFloat)
@end

// Deliver window and reserved-region changes from the full-window geometry sensor.
@interface RCT_EXTERN_MODULE (NavigationGeometryViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(onGeometryChange, RCTDirectEventBlock)
@end

@interface OrotAppMetadata : NSObject <RCTBridgeModule>
@end
@implementation OrotAppMetadata
RCT_EXPORT_MODULE(OrotAppMetadata)
+ (BOOL)requiresMainQueueSetup {
    return YES;
}
- (NSDictionary *)constantsToExport {
    // The installed build is the version authority, not a design sample or package dependency
    // version.
    return @{
        @"version" :
                [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"]
            ?: @""
    };
}
@end

// Render SF Symbols as native images; labels stay on their containing controls.
@interface RCT_EXTERN_MODULE (AppSymbolViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(symbolName, NSString)
RCT_EXPORT_VIEW_PROPERTY(pointSize, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(tintColor, UIColor)
@end

// Progress follows the lifetime of its mounted UIKit view, including React reuse.
@interface RCT_EXTERN_MODULE (AppProgressViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(active, BOOL)
RCT_EXPORT_VIEW_PROPERTY(large, BOOL)
RCT_EXPORT_VIEW_PROPERTY(color, UIColor)
@end

// UIKit owns the complete button, including native Glass highlighting and disabled accessibility.
@interface RCT_EXTERN_MODULE (GlassIconButtonManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(symbolName, NSString)
RCT_EXPORT_VIEW_PROPERTY(actionLabel, NSString)
RCT_EXPORT_VIEW_PROPERTY(actionHint, NSString)
RCT_EXPORT_VIEW_PROPERTY(actionTestID, NSString)
RCT_EXPORT_VIEW_PROPERTY(disabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(busy, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onAction, RCTDirectEventBlock)
@end
