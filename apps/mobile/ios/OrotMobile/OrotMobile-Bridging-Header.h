#import "LocalE5SentencePieceTokenizer.h"

#if OROT_TESTS
// Read the dependency's declared native flag only in diagnostic builds.
#import <UIKit/UIKit.h>
#import <RNScreens/RNSScreen.h>
#import <React/UIView+React.h>

NS_ASSUME_NONNULL_BEGIN

// These synchronous projections use declared getters only. No view loading, delegate calls or
// retention of the identifier block or inspected UIKit objects escapes the observation.
static inline NSDictionary<NSString *, id> *
OrotTestViewProjection(UIView *_Nullable view, UIView *_Nullable loadedControllerView,
                       NSString * (^identifier)(NSObject *)) {
    if (!view) {
        return @{@"status" : @"missing-view"};
    }
    RNSScreenView *screen = [view isKindOfClass:RNSScreenView.class] ? (RNSScreenView *)view : nil;
    return @{
        @"status" : @"present",
        @"viewID" : identifier(view),
        @"type" : NSStringFromClass(view.class),
        @"matchesLoadedControllerView" : loadedControllerView ? @(view == loadedControllerView)
                                                              : NSNull.null,
        @"preventNativeDismiss" : screen ? @(screen.preventNativeDismiss) : NSNull.null
    };
}

// Keep absent targets distinct from real non-members. Never cast NSNotFound to a native index.
static inline NSDictionary<NSString *, id> *OrotTestReactMembership(NSArray<UIView *> *siblings,
                                                                    UIView *_Nullable target) {
    if (!target) {
        return @{@"status" : @"missing-view", @"index" : NSNull.null};
    }
    NSUInteger index = [siblings indexOfObjectIdenticalTo:target];
    return index == NSNotFound ? @{@"status" : @"not-member", @"index" : NSNull.null}
                               : @{@"status" : @"member",
                                   @"index" : @(index)};
}

// React exposes these getters on UIView; RNS supplies its own screen/container implementations.
// The returned order is a snapshot, not proof of what an earlier delegate decision inspected.
static inline NSDictionary<NSString *, id> *
OrotTestReactStack(UIView *_Nullable source, UIView *_Nullable destination,
                   NSString * (^identifier)(NSObject *)) {
    if (!source) {
        return @{@"status" : @"missing-source-view"};
    }
    UIView *container = [source reactSuperview];
    if (!container) {
        return @{@"status" : @"missing-reactSuperview"};
    }
    NSArray<UIView *> *siblings = [container reactSubviews];
    if (!siblings) {
        return @{@"status" : @"missing-reactSubviews"};
    }
    NSMutableArray *children = [NSMutableArray new];
    [siblings enumerateObjectsUsingBlock:^(UIView *view, NSUInteger index, BOOL *stop) {
      [children addObject:@{
          @"index" : @(index),
          @"view" : OrotTestViewProjection(view, nil, identifier)
      }];
    }];
    return @{
        @"status" : @"observed",
        @"containerViewID" : identifier(container),
        @"containerType" : NSStringFromClass(container.class),
        @"children" : children,
        @"sourceMembership" : OrotTestReactMembership(siblings, source),
        @"destinationMembership" : OrotTestReactMembership(siblings, destination)
    };
}

static inline NSDictionary<NSString *, id> *
OrotTestContextViews(UIView *_Nullable source, UIView *_Nullable destination,
                     UIView *_Nullable loadedSource, UIView *_Nullable loadedDestination,
                     NSString * (^identifier)(NSObject *)) {
    return @{
        @"sourceView" : OrotTestViewProjection(source, loadedSource, identifier),
        @"destinationView" : OrotTestViewProjection(destination, loadedDestination, identifier),
        @"sourceReactStack" : OrotTestReactStack(source, destination, identifier),
        // Label the alternate projection explicitly; it never substitutes for a missing context
        // view.
        @"loadedControllerSourceReactStack" : source && source == loadedSource
            ? @{@"status" : @"same-as-context-source"}
            : OrotTestReactStack(loadedSource, loadedDestination, identifier)
    };
}

NS_ASSUME_NONNULL_END
#endif
