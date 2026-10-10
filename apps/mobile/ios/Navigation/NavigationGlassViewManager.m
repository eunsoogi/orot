#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>

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
