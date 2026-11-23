#import <React/RCTView.h>
#import <React/RCTViewManager.h>
#import <UIKit/UIKit.h>

/// UIKit owns the long press, lift, haptic, placement and dismissal. The React
/// view never leaves its transcript layout and no second renderer copies it.
@interface OrotConversationBubbleCopyView : RCTView <UIContextMenuInteractionDelegate>
@property(nonatomic, copy, nullable) NSString *copyText;
@property(nonatomic, copy, nullable) NSString *copyOwner;
@property(nonatomic, copy, nullable) NSString *copyLabel;
@property(nonatomic, strong, nullable) UIContextMenuInteraction *copyInteraction;
@property(nonatomic) NSUInteger copyRevision;
@property(nonatomic) BOOL observingAvailability;
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

- (UIContextMenuConfiguration *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                        configurationForMenuAtLocation:(CGPoint)location {
    if (![self canCopyRevision:self.copyRevision]) {
        return nil;
    }
    NSUInteger revision = ++self.copyRevision;
    [self observeAvailability];
    __weak OrotConversationBubbleCopyView *weakView = self;
    NSString *label = self.copyLabel;
    return [UIContextMenuConfiguration
        configurationWithIdentifier:nil
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
    [self stopObservingAvailability];
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
