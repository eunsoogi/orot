#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>

// Native trailing swipe actions emit only the selected session identity.
@interface RCT_EXTERN_MODULE (ConversationHistoryViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(rows, NSArray)
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
RCT_EXPORT_VIEW_PROPERTY(onPress, RCTDirectEventBlock)
@end

// Register the Swift view manager with React Native's UIKit view registry.
@interface RCT_EXTERN_MODULE (NavigationGlassViewManager, RCTViewManager)
// Bridge serializable actions and tap events without replacing their JS semantics.
RCT_EXPORT_VIEW_PROPERTY(actions, NSArray)
RCT_EXPORT_VIEW_PROPERTY(onAction, RCTBubblingEventBlock)
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
