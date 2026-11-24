#import <QuartzCore/QuartzCore.h>
#import <React/RCTView.h>
#import <React/RCTViewManager.h>
#import <React/UIView+React.h>
#import <UIKit/UIKit.h>

// The pinned Fabric facade is Objective-C++, but exposes this Objective-C getter.
@protocol OrotBubblePaintContainer <NSObject>
- (nullable UIView *)contentView;
@end
/// UIKit owns the long press, lift, haptic, placement and dismissal. The React
/// view never leaves its transcript layout and no second renderer copies it.
@interface OrotConversationBubbleCopyView : RCTView <UIContextMenuInteractionDelegate>
- (nullable NSString *)copyText __attribute__((objc_method_family(none)));
@property(nonatomic, copy, nullable) NSString *copyText;
- (nullable NSString *)copyOwner __attribute__((objc_method_family(none)));
@property(nonatomic, copy, nullable) NSString *copyOwner;
- (nullable NSString *)copyLabel __attribute__((objc_method_family(none)));
@property(nonatomic, copy, nullable) NSString *copyLabel;
- (nullable UIContextMenuInteraction *)copyInteraction __attribute__((objc_method_family(none)));
@property(nonatomic, strong, nullable) UIContextMenuInteraction *copyInteraction;
@property(nonatomic) NSUInteger copyRevision;
@property(nonatomic) BOOL observingAvailability;
@property(nonatomic, strong, nullable) NSUUID *previewMenuIdentifier;
@property(nonatomic, weak, nullable) UIView *previewPaintView;
@property(nonatomic) NSUInteger previewOpenRevision;
@property(nonatomic) NSUInteger previewCloseRevision;
@end
@implementation OrotConversationBubbleCopyView
- (void)stopObservingAvailability {
    if (!self.observingAvailability) {
        return;
    }
    self.observingAvailability = NO;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center removeObserver:self name:UIApplicationWillResignActiveNotification object:nil];
    [center removeObserver:self name:UIApplicationProtectedDataWillBecomeUnavailable object:nil];
}
- (void)retireCopyMenu {
    self.copyRevision += 1;
    self.previewMenuIdentifier = nil;
    self.previewPaintView = nil;
    [self.copyInteraction dismissMenu];
    [self stopObservingAvailability];
}
- (void)availabilityChanged:(NSNotification *)notification {
    [self retireCopyMenu];
}
- (void)observeAvailability {
    if (self.observingAvailability) {
        return;
    }
    self.observingAvailability = YES;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self
               selector:@selector(availabilityChanged:)
                   name:UIApplicationWillResignActiveNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(availabilityChanged:)
                   name:UIApplicationProtectedDataWillBecomeUnavailable
                 object:nil];
}
- (void)setCopyOwner:(NSString *)copyOwner {
    if (_copyOwner == copyOwner || [_copyOwner isEqualToString:copyOwner]) {
        return;
    }
    [self retireCopyMenu];
    _copyOwner = [copyOwner copy];
}
- (void)setCopyText:(NSString *)copyText {
    if (_copyText == copyText || [_copyText isEqualToString:copyText]) {
        return;
    }
    [self retireCopyMenu];
    _copyText = [copyText copy];
    if (_copyText.length && !self.copyInteraction) {
        self.copyInteraction = [[UIContextMenuInteraction alloc] initWithDelegate:self];
        [self addInteraction:self.copyInteraction];
    }
}
- (void)didMoveToWindow {
    [super didMoveToWindow];
    if (!self.window) {
        [self retireCopyMenu];
    }
}
- (BOOL)canCopyRevision:(NSUInteger)revision {
    UIApplication *application = UIApplication.sharedApplication;
    UIWindow *window = self.window;
    return revision == self.copyRevision && self.copyOwner.length > 0 && self.copyText.length > 0 &&
           self.copyLabel.length > 0 && window && !window.hidden && window.windowScene &&
           window.windowScene.activationState == UISceneActivationStateForegroundActive &&
           CGRectIntersectsRect(window.bounds, [self convertRect:self.bounds toView:window]) &&
           application.applicationState == UIApplicationStateActive &&
           application.isProtectedDataAvailable;
}
- (nullable UIView *)paintedBubbleView {
    Class interop = NSClassFromString(@"RCTLegacyViewManagerInteropComponentView");
    UIView *facade = nil;
    UIView *parent = self.superview;
    // Fabric mounts its Paper content directly, or in its one overflow container.
    for (NSUInteger level = 0; interop && level < 2 && parent; level++, parent = parent.superview) {
        if ([parent isKindOfClass:interop] && [parent respondsToSelector:@selector(contentView)] &&
            [(UIView<OrotBubblePaintContainer> *)parent contentView] == self) {
            facade = parent;
            break;
        }
    }
    NSString *role =
        self.reactAccessibilityElement.accessibilityIdentifier ?: facade.accessibilityIdentifier;
    // Anchor the lift on the same Fabric surface that owns the gesture. UIKit
    // can lift this facade and its children together; targeting its inner
    // assistant body from a different host left only the background visible.
    return ([role isEqualToString:@"conversation-user-message"] ||
            [role isEqualToString:@"conversation-message-body"] ||
            [role isEqualToString:@"conversation-opening-body"])
               ? facade
               : nil;
}
- (nullable UITargetedPreview *)
    targetedPreviewForInteraction:(UIContextMenuInteraction *)interaction
                    configuration:(UIContextMenuConfiguration *)configuration
                       dismissing:(BOOL)dismissing {
    NSUInteger revision = dismissing ? self.previewCloseRevision : self.previewOpenRevision;
    UIView *paint = self.previewPaintView;
    if (interaction != self.copyInteraction ||
        ![self.previewMenuIdentifier isEqual:configuration.identifier] ||
        ![self canCopyRevision:revision] || !paint || paint != [self paintedBubbleView] ||
        paint.window != self.window || paint.hidden || paint.alpha <= 0 ||
        CGRectIsEmpty(paint.bounds)) {
        return nil;
    }
    UIPreviewParameters *parameters = [UIPreviewParameters new];
    parameters.backgroundColor = UIColor.clearColor;
    if (paint.layer.cornerRadius > 0 &&
        [paint.layer.cornerCurve isEqualToString:kCACornerCurveCircular]) {
        parameters.visiblePath = [UIBezierPath bezierPathWithRoundedRect:paint.bounds
                                                            cornerRadius:paint.layer.cornerRadius];
    }
    return [[UITargetedPreview alloc] initWithView:paint parameters:parameters];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 highlightPreviewForItemWithIdentifier:(id<NSCopying>)identifier {
    return [self targetedPreviewForInteraction:interaction
                                 configuration:configuration
                                    dismissing:NO];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 dismissalPreviewForItemWithIdentifier:(id<NSCopying>)identifier {
    return [self targetedPreviewForInteraction:interaction
                                 configuration:configuration
                                    dismissing:YES];
}

- (UIContextMenuConfiguration *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                        configurationForMenuAtLocation:(CGPoint)location {
    if (interaction != self.copyInteraction || ![self canCopyRevision:self.copyRevision]) {
        return nil;
    }
    NSUInteger revision = ++self.copyRevision;
    NSUUID *menuIdentifier = NSUUID.UUID;
    self.previewMenuIdentifier = menuIdentifier;
    self.previewPaintView = [self paintedBubbleView];
    self.previewOpenRevision = revision;
    self.previewCloseRevision = revision;
    [self observeAvailability];
    __weak OrotConversationBubbleCopyView *weakView = self;
    NSString *label = self.copyLabel;
    return [UIContextMenuConfiguration
        configurationWithIdentifier:menuIdentifier
                    previewProvider:nil
                     actionProvider:^UIMenu *(NSArray<UIMenuElement *> *suggested) {
                       UIAction *copy = [UIAction
                           actionWithTitle:label
                                     image:[UIImage systemImageNamed:@"doc.on.doc"]
                                identifier:nil
                                   handler:^(__kindof UIAction *action) {
                                     OrotConversationBubbleCopyView *view = weakView;
                                     if (![view canCopyRevision:revision]) {
                                         return;
                                     }
                                     // One fresh explicit menu action owns this single local write.
                                     view.copyRevision += 1;
                                     view.previewCloseRevision = view.copyRevision;
                                     [UIPasteboard.generalPasteboard
                                         setItems:@[ @{@"public.utf8-plain-text" : view.copyText} ]
                                          options:@{
                                              UIPasteboardOptionLocalOnly : @YES
                                          }];
                                   }];
                       return [UIMenu menuWithTitle:@"" children:@[ copy ]];
                     }];
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
       willEndForConfiguration:(UIContextMenuConfiguration *)configuration
                      animator:(id<UIContextMenuInteractionAnimating>)animator {
    if (interaction != self.copyInteraction ||
        ![self.previewMenuIdentifier isEqual:configuration.identifier]) {
        return;
    }
    id<NSCopying> identifier = configuration.identifier;
    __weak OrotConversationBubbleCopyView *weakView = self;
    void (^finish)(void) = ^{
      OrotConversationBubbleCopyView *view = weakView;
      if ([view.previewMenuIdentifier isEqual:identifier]) {
          view.previewMenuIdentifier = nil;
          view.previewPaintView = nil;
          [view stopObservingAvailability];
      }
    };
    if (animator) {
        [animator addCompletion:finish];
    } else {
        finish();
    }
}
@end

@interface ConversationBubbleCopyViewManager : RCTViewManager
@end

@implementation ConversationBubbleCopyViewManager
RCT_EXPORT_MODULE(ConversationBubbleCopyView)
RCT_EXPORT_VIEW_PROPERTY(copyOwner, NSString)
RCT_EXPORT_VIEW_PROPERTY(copyText, NSString)
RCT_EXPORT_VIEW_PROPERTY(copyLabel, NSString)

- (UIView *)view {
    return [OrotConversationBubbleCopyView new];
}
@end
