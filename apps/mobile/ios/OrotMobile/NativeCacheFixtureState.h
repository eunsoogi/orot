#pragma once
#include <TargetConditionals.h>
#if defined(OROT_TESTS) && TARGET_OS_SIMULATOR
#include "NativeCacheTestTrace.h"
#include "../../node_modules/@op-engineering/op-sqlite/cpp/OPDatabase.hpp"
namespace opsqlite {
// Friend-only test access changes no layout and adds no production execution hook.
struct OrotNativeCacheTestAccess {
    static sqlite3 *database(OPDatabase &owner) { return owner.db; }
    static void drain(OPDatabase &owner) { owner.thread_pool->wait_finished(); }
};
} // namespace opsqlite
namespace orot_test {
namespace jsi = facebook::jsi;
using Access = opsqlite::OrotNativeCacheTestAccess;
inline void require(bool condition, const char *message) {
    if (!condition)
        throw std::runtime_error(message);
}
struct Fixture final : jsi::NativeState {
    std::shared_ptr<opsqlite::OPDatabase> owner;
    std::shared_ptr<jsi::Object> raw;
    NativeCacheTrace trace;
    std::string directory, key;
    bool disposed = false;
    bool executionSubmitted = false;
    bool actionIssued = false, reopened = false;
    bool cleanup();
    bool verifyReopen(jsi::Runtime &runtime);
    ~Fixture() override;
};
std::shared_ptr<Fixture> makeFixtureState(jsi::Runtime &runtime);
} // namespace orot_test
#endif
