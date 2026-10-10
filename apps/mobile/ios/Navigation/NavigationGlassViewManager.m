#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>

// Register the Swift view manager with React Native's UIKit view registry.
@interface RCT_EXTERN_MODULE (NavigationGlassViewManager, RCTViewManager)
// Bridge serializable actions and tap events without replacing their JS semantics.
RCT_EXPORT_VIEW_PROPERTY(actions, NSArray)
RCT_EXPORT_VIEW_PROPERTY(onAction, RCTBubblingEventBlock)
@end
