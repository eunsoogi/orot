#pragma once
#include <TargetConditionals.h>
#if defined(OROT_TESTS) && TARGET_OS_SIMULATOR
#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>
#include <memory>

namespace orot_test {
// Factory accepts no name, path, key, SQL, or external database handle.
facebook::jsi::Object
makeNativeCacheOwnerFixture(facebook::jsi::Runtime &runtime,
                            const std::shared_ptr<facebook::react::CallInvoker> &invoker);
} // namespace orot_test
#endif
