#if OROT_TESTS
#import <React/RCTViewManager.h>

// The manager exists only in native test products, with no exported production view.
@interface RCT_EXTERN_MODULE (OrotNavigationBoundaryViewManager, RCTViewManager)
@end
#endif
