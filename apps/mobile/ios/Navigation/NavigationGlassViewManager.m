#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>
#import <UIKit/UIKit.h>

// Native trailing swipe actions emit only the selected session identity.
@interface RCT_EXTERN_MODULE (ConversationHistoryViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(rows, NSArray)
// The table scrolls its large title while React retains session ownership and color tokens.
RCT_EXPORT_VIEW_PROPERTY(headerTitle, NSString)
RCT_EXPORT_VIEW_PROPERTY(headerCount, NSString)
RCT_EXPORT_VIEW_PROPERTY(newSessionLabel, NSString)
RCT_EXPORT_VIEW_PROPERTY(headerTextColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(headerSecondaryColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(headerTintColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(onCreateSession, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSelectSession, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onDeleteSession, RCTDirectEventBlock)
@end

// The composer owns input and actions in React; this view supplies only native material.
@interface RCT_EXTERN_MODULE (ComposerGlassViewManager, RCTViewManager)
@end

// UIKit owns the interactive Glass control; React owns the current Send/Stop action.
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
RCT_EXPORT_VIEW_PROPERTY(onAction, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(layoutMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(railTopInset, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(railBottomInset, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(railRightInset, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(railAvailableHeight, CGFloat)
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
