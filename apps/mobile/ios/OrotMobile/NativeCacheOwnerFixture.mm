#include "NativeCacheOwnerFixture.h"
#if defined(OROT_TESTS) && TARGET_OS_SIMULATOR
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include "NativeCacheTestTrace.h"
#include "NativeCacheFixtureState.h"
#include "../../node_modules/@op-engineering/op-sqlite/cpp/OrotPeriodQueries.hpp"
#include <array>
#include <algorithm>

namespace orot_test {
std::string query(jsi::Runtime &rt, const jsi::Value *args, size_t count) {
    require(count == 1 && args[0].isString(), "Exact static query required");
    auto sql = args[0].asString(rt).utf8(rt);
    require(opsqlite::orotCacheEligible(sql) &&
                sql.find("health_observations") != std::string::npos,
            "Only fixed measurement templates are allowed");
    return sql;
}
jsi::Object
makeNativeCacheOwnerFixture(jsi::Runtime &rt,
                            const std::shared_ptr<facebook::react::CallInvoker> &invoker) {
    auto state = makeFixtureState(rt);
    jsi::Object fixture(rt);
    fixture.setNativeState(rt, state);
    auto install = [&](const char *name, unsigned arity, jsi::HostFunctionType fn) {
        fixture.setProperty(
            rt, name,
            jsi::Function::createFromHostFunction(
                rt, jsi::PropNameID::forAscii(rt, name), arity,
                [state, fn = std::move(fn)](jsi::Runtime &runtime, const jsi::Value &self,
                                            const jsi::Value *args, size_t count) {
                    require(self.isObject() &&
                                self.asObject(runtime).hasNativeState<Fixture>(runtime) &&
                                self.asObject(runtime).getNativeState<Fixture>(runtime) == state,
                            "Foreign fixture receiver rejected");
                    return fn(runtime, self, args, count);
                }));
    };
    install(
        "execute", 1,
        [state](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) {
            require(!state->disposed, "Fixture closed");
            auto sql = query(runtime, args, count);
            jsi::Array values(runtime, 3);
            values.setValueAtIndex(runtime, 0, "measurements");
            values.setValueAtIndex(runtime, 1, "");
            values.setValueAtIndex(runtime, 2, "~");
            require(!state->executionSubmitted, "Previous execution has not settled");
            state->executionSubmitted = true;
            try {
                auto promise = state->raw->getPropertyAsFunction(runtime, "execute")
                                   .call(runtime, jsi::String::createFromUtf8(runtime, sql), values)
                                   .asObject(runtime);
                auto settle = [&](bool reject) {
                    return jsi::Function::createFromHostFunction(
                        runtime, jsi::PropNameID::forAscii(runtime, "settleFixture"), 1,
                        [state, reject](jsi::Runtime &inner, const jsi::Value &,
                                        const jsi::Value *result, size_t count) -> jsi::Value {
                            state->executionSubmitted = false;
                            jsi::Value value =
                                count ? jsi::Value(inner, result[0]) : jsi::Value::undefined();
                            if (reject)
                                throw jsi::JSError(inner, std::move(value));
                            return value;
                        });
                };
                return promise.getPropertyAsFunction(runtime, "then")
                    .callWithThis(runtime, promise, settle(false), settle(true));
            } catch (...) {
                state->executionSubmitted = false;
                throw;
            }
        });
    install("arm", 1,
            [state, invoker](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args,
                             size_t count) {
                require(!state->disposed, "Fixture closed");
                auto sql = query(runtime, args, count);
                require(!state->executionSubmitted && !state->trace.armed.load() &&
                            (!state->trace.entered || state->trace.interrupted ||
                             state->trace.timedOut),
                        "Previous step is still armed or active");
                Access::drain(*state->owner);
                state->actionIssued = false;
                auto executor = jsi::Function::createFromHostFunction(
                    runtime, jsi::PropNameID::forAscii(runtime, "arm"), 2,
                    [state, invoker, sql](jsi::Runtime &inner, const jsi::Value &,
                                          const jsi::Value *callbacks, size_t) {
                        auto resolve = std::make_shared<jsi::Value>(inner, callbacks[0]);
                        auto alive = opsqlite::generation_alive;
                        state->trace.arm(sql, [invoker, alive, resolve] {
                            if (!alive || !alive->load())
                                return;
                            invoker->invokeAsync([resolve, alive](jsi::Runtime &target) {
                                if (alive->load())
                                    resolve->asObject(target).asFunction(target).call(target, true);
                            });
                        });
                        return jsi::Value::undefined();
                    });
                return runtime.global()
                    .getPropertyAsFunction(runtime, "Promise")
                    .callAsConstructor(runtime, executor);
            });
    install("interrupt", 0,
            [state](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *, size_t) {
                require(!state->actionIssued && state->trace.entered && !state->trace.interrupted &&
                            !state->trace.timedOut && !state->disposed,
                        "A new active step is required");
                state->actionIssued = true;
                return state->raw->getPropertyAsFunction(runtime, "interrupt").call(runtime);
            });
    install("invalidate", 0,
            [state](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) {
                require(!state->actionIssued && state->trace.entered && !state->trace.interrupted &&
                            !state->trace.timedOut && !state->disposed,
                        "A new active step is required");
                state->actionIssued = true;
                state->owner->invalidate();
                state->disposed = true;
                return jsi::Value::undefined();
            });
    install("verifyReopen", 0,
            [state](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *, size_t) {
                return jsi::Value(state->verifyReopen(runtime));
            });
    install("dispose", 0, [state](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) {
        return jsi::Value(state->cleanup());
    });
    install("snapshot", 0,
            [state](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *, size_t) {
                require(!state->executionSubmitted && !state->trace.armed.load() &&
                            (!state->trace.entered || state->trace.interrupted ||
                             state->trace.timedOut),
                        "Snapshot requires a settled step");
                Access::drain(*state->owner);
                auto *handle = Access::database(*state->owner);
                int cached = 0, maxRuns = 0;
                if (handle)
                    for (auto *stmt = sqlite3_next_stmt(handle, nullptr); stmt;
                         stmt = sqlite3_next_stmt(handle, stmt)) {
                        const auto *sql = sqlite3_sql(stmt);
                        if (sql && opsqlite::orotCacheEligible(sql)) {
                            ++cached;
                            maxRuns = std::max(maxRuns,
                                               sqlite3_stmt_status(stmt, SQLITE_STMTSTATUS_RUN, 0));
                        }
                    }
                jsi::Object result(runtime);
                result.setProperty(runtime, "cachedStatements", cached);
                result.setProperty(runtime, "maximumRuns", maxRuns);
                result.setProperty(runtime, "ownerClosed", handle == nullptr);
                result.setProperty(runtime, "stepEntered", state->trace.entered.load());
                result.setProperty(runtime, "interruptObserved", state->trace.interrupted.load());
                result.setProperty(runtime, "timedOut", state->trace.timedOut.load());
                result.setProperty(runtime, "closeSeen", state->trace.closeSeen.load());
                result.setProperty(runtime, "closeStatements", state->trace.closeStatements.load());
                result.setProperty(runtime, "closeBusy", state->trace.closeBusy.load());
                return jsi::Value(std::move(result));
            });
    return fixture;
}
} // namespace orot_test
#endif
