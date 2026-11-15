#import <UIKit/UIKit.h>
#import <RNScreens/RNSScreenStackAnimator.h>
#import <XCTest/XCTest.h>

// Wait for actual window appearance before capturing, then balance fixture teardown.
@interface FadeHostController : UIViewController
@property(nonatomic, copy) void (^appeared)(void);
@property(nonatomic, copy) void (^disappeared)(void);
@end
@implementation FadeHostController
- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    if (self.appeared)
        self.appeared();
}
- (void)viewDidDisappear:(BOOL)animated {
    [super viewDidDisappear:animated];
    if (self.disappeared)
        self.disappeared();
}
@end

// Observe the real UIKit snapshot path so an off-window fallback cannot satisfy the test.
@interface FadeObservedSurface : UIView
@property(nonatomic) BOOL producedSnapshot;
@end
@implementation FadeObservedSurface
- (UIView *)snapshotViewAfterScreenUpdates:(BOOL)afterUpdates {
    UIView *snapshot = [super snapshotViewAfterScreenUpdates:afterUpdates];
    self.producedSnapshot = snapshot != nil;
    return snapshot;
}
@end

// Exercise the pinned animator directly with synthetic surfaces, not private app data.
@interface RNSScreenStackAnimator (FadeTesting)
- (void)animateFadeWithTransitionContext:(id<UIViewControllerContextTransitioning>)context
                                    toVC:(UIViewController *)toVC
                                  fromVC:(UIViewController *)fromVC;
@end

@interface FadeTestAnimator : RNSScreenStackAnimator
@end
@implementation FadeTestAnimator
- (NSTimeInterval)transitionDuration:(id<UIViewControllerContextTransitioning>)context {
    return 0.22;
}
@end

@interface FadeTestContext : NSObject <UIViewControllerContextTransitioning>
@property(nonatomic, strong) UIView *containerView;
@property(nonatomic, strong) UIViewController *from;
@property(nonatomic, strong) UIViewController *to;
@property(nonatomic) BOOL cancelled;
@property(nonatomic) BOOL completed;
@property(nonatomic) BOOL result;
@end
@implementation FadeTestContext
- (BOOL)isAnimated {
    return YES;
}
- (BOOL)isInteractive {
    return YES;
}
- (BOOL)transitionWasCancelled {
    return self.cancelled;
}
- (UIModalPresentationStyle)presentationStyle {
    return UIModalPresentationFullScreen;
}
- (CGAffineTransform)targetTransform {
    return CGAffineTransformIdentity;
}
- (UIViewController *)viewControllerForKey:(UITransitionContextViewControllerKey)key {
    return [key isEqual:UITransitionContextFromViewControllerKey] ? self.from : self.to;
}
- (UIView *)viewForKey:(UITransitionContextViewKey)key {
    return [key isEqual:UITransitionContextFromViewKey] ? self.from.view : self.to.view;
}
- (CGRect)initialFrameForViewController:(UIViewController *)viewController {
    return self.containerView.bounds;
}
- (CGRect)finalFrameForViewController:(UIViewController *)viewController {
    return self.containerView.bounds;
}
- (void)updateInteractiveTransition:(CGFloat)percentComplete {
}
- (void)finishInteractiveTransition {
}
- (void)cancelInteractiveTransition {
    self.cancelled = YES;
}
- (void)pauseInteractiveTransition {
}
- (void)completeTransition:(BOOL)didComplete {
    self.completed = YES;
    self.result = didComplete;
}
@end

@interface NavigationFadeIntegrationTests : XCTestCase
@end
@implementation NavigationFadeIntegrationTests

// The actual UIKit animator must preserve live glass ancestry during push/pop and cancellation.
- (void)verifyOperation:(UINavigationControllerOperation)operation
              cancelled:(BOOL)cancelled
           cleanupEvent:(NSString *)event {
    UIWindowScene *scene =
        (UIWindowScene *)UIApplication.sharedApplication.connectedScenes.anyObject;
    UIWindow *previousWindow = scene.keyWindow;
    UIWindow *window = [[UIWindow alloc] initWithWindowScene:scene];
    FadeHostController *host = [FadeHostController new];
    XCTestExpectation *appeared = [self expectationWithDescription:@"fixture window appeared"];
    XCTestExpectation *disappeared =
        [self expectationWithDescription:@"fixture window disappeared"];
    host.appeared = ^{
      [appeared fulfill];
    };
    host.disappeared = ^{
      [disappeared fulfill];
    };
    window.rootViewController = host;
    [window makeKeyAndVisible];
    XCTAssertEqual([XCTWaiter waitForExpectations:@[ appeared ] timeout:2],
                   XCTWaiterResultCompleted);
    FadeTestContext *context = [FadeTestContext new];
    context.containerView = host.view;
    context.from = [UIViewController new];
    FadeObservedSurface *source = [FadeObservedSurface new];
    context.from.view = source;
    context.to = [UIViewController new];
    context.from.view.frame = context.containerView.bounds;
    context.to.view.frame = context.containerView.bounds;
    context.from.view.backgroundColor = UIColor.systemBackgroundColor;
    UIVisualEffect *effect;
    if (@available(iOS 26.0, *)) {
        effect = [UIGlassEffect effectWithStyle:UIGlassEffectStyleRegular];
    } else {
        effect = [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemMaterial];
    }
    UIVisualEffectView *glass = [[UIVisualEffectView alloc] initWithEffect:effect];
    glass.frame = CGRectMake(20, 20, 200, 48);
    [context.to.view addSubview:glass];
    [host addChildViewController:context.from];
    [context.containerView addSubview:context.from.view];
    [context.from didMoveToParentViewController:host];
    [window layoutIfNeeded];
    XCTAssertNotNil([source snapshotViewAfterScreenUpdates:YES]);
    FadeTestAnimator *animator = [[FadeTestAnimator alloc] initWithOperation:operation];
    [animator animateFadeWithTransitionContext:context toVC:context.to fromVC:context.from];
    XCTAssertTrue(source.producedSnapshot);
    [animator.inFlightAnimator pauseAnimation];
    animator.inFlightAnimator.fractionComplete = 0.5;
    XCTAssertEqual(context.from.view.alpha, 1);
    XCTAssertEqual(context.to.view.alpha, 1);
    XCTAssertEqual(glass.alpha, 1);
    XCTAssertNotNil(glass.effect);
    XCTAssertTrue(CGAffineTransformIsIdentity(context.from.view.transform));
    XCTAssertTrue(CGAffineTransformIsIdentity(context.to.view.transform));
    XCTAssertTrue([(id)animator.timingParamsForAnimationCompletion
        isKindOfClass:UICubicTimingParameters.class]);
    UIView *snapshot = context.containerView.subviews.lastObject;
    XCTAssertNotEqual(snapshot, context.from.view);
    XCTAssertNotEqual(snapshot, context.to.view);
    XCTAssertFalse(snapshot.userInteractionEnabled);
    XCTAssertTrue(snapshot.accessibilityElementsHidden);
    if (event != nil) {
        [NSNotificationCenter.defaultCenter postNotificationName:event object:nil];
        XCTAssertNil(snapshot.superview);
        XCTAssertFalse(context.from.view.hidden);
        // A subsequent privacy mask owns this state; repeated cleanup must not undo it.
        context.from.view.hidden = YES;
    }
    context.cancelled = cancelled;
    [animator.inFlightAnimator stopAnimation:NO];
    [animator.inFlightAnimator finishAnimationAtPosition:cancelled ? UIViewAnimatingPositionStart
                                                                   : UIViewAnimatingPositionEnd];
    XCTAssertTrue(context.completed);
    XCTAssertEqual(context.result, !cancelled);
    XCTAssertEqual(context.from.view.hidden, event != nil);
    XCTAssertNil(snapshot.superview);
    XCTAssertEqual(context.to.view.alpha, 1);
    XCTAssertNotNil(glass.effect);
    [animator animationEnded:!cancelled];
    [context.from willMoveToParentViewController:nil];
    [context.from.view removeFromSuperview];
    [context.from removeFromParentViewController];
    // UIWindow hiding does not deliver a controller disappearance on its own.
    [host beginAppearanceTransition:NO animated:NO];
    window.hidden = YES;
    [host endAppearanceTransition];
    XCTAssertEqual([XCTWaiter waitForExpectations:@[ disappeared ] timeout:2],
                   XCTWaiterResultCompleted);
    [previousWindow makeKeyWindow];
}

- (void)testPushKeepsGlassOpaqueAndRemovesSnapshot {
    [self verifyOperation:UINavigationControllerOperationPush cancelled:NO cleanupEvent:nil];
}
- (void)testPopKeepsGlassOpaqueAndRemovesSnapshot {
    [self verifyOperation:UINavigationControllerOperationPop cancelled:NO cleanupEvent:nil];
}
- (void)testCancelledPushRestoresSourceAndRemovesSnapshot {
    [self verifyOperation:UINavigationControllerOperationPush cancelled:YES cleanupEvent:nil];
}
- (void)testCancelledPopRestoresSourceAndRemovesSnapshot {
    [self verifyOperation:UINavigationControllerOperationPop cancelled:YES cleanupEvent:nil];
}
- (void)testBackgroundDropsTransientSnapshotBeforeCompletion {
    [self verifyOperation:UINavigationControllerOperationPush
                cancelled:NO
             cleanupEvent:UIApplicationWillResignActiveNotification];
}
- (void)testCaptureChangeDropsTransientSnapshotBeforeCompletion {
    [self verifyOperation:UINavigationControllerOperationPop
                cancelled:YES
             cleanupEvent:UIScreenCapturedDidChangeNotification];
}
@end
