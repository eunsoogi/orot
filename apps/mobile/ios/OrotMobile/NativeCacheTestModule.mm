#import <TargetConditionals.h>
#if defined(OROT_TESTS) && TARGET_OS_SIMULATOR
#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#include "NativeCacheOwnerFixture.h"

// No class, module registration, or global binding exists in production or on
// a physical device. The factory takes no external paths, keys, or DB handles.
@interface OrotNativeCacheTest : NSObject <RCTBridgeModule, RCTTurboModuleWithJSIBindings>
@end
@implementation OrotNativeCacheTest
RCT_EXPORT_MODULE(OrotNativeCacheTest)
+ (BOOL)requiresMainQueueSetup {
    return NO;
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
    return std::make_shared<facebook::react::ObjCTurboModule>(params);
}
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                          callInvoker:
                              (const std::shared_ptr<facebook::react::CallInvoker> &)invoker {
    namespace jsi = facebook::jsi;
    runtime.global().setProperty(
        runtime, "__orotCreateNativeCacheFixture",
        jsi::Function::createFromHostFunction(
            runtime, jsi::PropNameID::forAscii(runtime, "__orotCreateNativeCacheFixture"), 0,
            [invoker](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *, size_t count) {
                if (count != 0)
                    throw std::runtime_error("No external fixture inputs accepted");
                return jsi::Value(orot_test::makeNativeCacheOwnerFixture(rt, invoker));
            }));
}
@end
#endif
