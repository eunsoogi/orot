#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

// The shared JS scroll host requests this only for a route-accepted user pull.
@interface RouteRefreshFeedbackModule : NSObject <RCTBridgeModule>
@end

@implementation RouteRefreshFeedbackModule

RCT_EXPORT_MODULE(RouteRefreshFeedbackModule)

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (dispatch_queue_t)methodQueue {
    return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(didAcceptPull) {
    if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
        return;
    }
    UIImpactFeedbackGenerator *generator =
        [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
    [generator impactOccurred];
}

@end
