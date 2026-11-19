#pragma once
#include <TargetConditionals.h>
#if defined(OROT_TESTS) && TARGET_OS_SIMULATOR
#include <atomic>
#include <chrono>
#include <functional>
#include <string>
#include <thread>
// The test runner supplies a per-file SQLCipher search path. OPTypes.hpp must
// resolve this same declaration set, never a second SDK SQLite header.
#if !defined(OP_SQLITE_USE_SQLCIPHER)
#error "Native owner tests require the SQLCipher fixture compiler setting"
#endif
#include <sqlite3.h>

namespace orot_test {
// Only an internally allocated fixture database registers this callback. It never
// expands SQL or emits keys, parameters, SQL text, pointer values, or row content.
struct NativeCacheTrace {
    std::atomic<bool> armed{false}, entered{false}, interrupted{false}, timedOut{false};
    std::atomic<bool> closeSeen{false};
    std::atomic<int> closeStatements{-1}, closeBusy{-1};
    std::string target;
    std::function<void()> notifyEntered;

    void arm(std::string sql, std::function<void()> notify) {
        target = std::move(sql);
        notifyEntered = std::move(notify);
        entered = false;
        interrupted = false;
        timedOut = false;
        armed.store(true, std::memory_order_release);
    }

    static int callback(unsigned kind, void *context, void *statement, void *) noexcept {
        auto &state = *static_cast<NativeCacheTrace *>(context);
        if (kind == SQLITE_TRACE_CLOSE) {
            auto *db = static_cast<sqlite3 *>(statement);
            int count = 0, busy = 0;
            for (auto *cursor = sqlite3_next_stmt(db, nullptr); cursor;
                 cursor = sqlite3_next_stmt(db, cursor)) {
                ++count;
                busy += sqlite3_stmt_busy(cursor) != 0;
            }
            state.closeStatements = count;
            state.closeBusy = busy;
            state.closeSeen = true;
            return 0;
        }
        auto *stmt = static_cast<sqlite3_stmt *>(statement);
        if (kind != SQLITE_TRACE_STMT || !state.armed.load(std::memory_order_acquire))
            return 0;
        const char *sql = sqlite3_sql(stmt);
        if (!sql || state.target != sql)
            return 0;
        if (!state.armed.exchange(false))
            return 0;
        try {
            state.entered = true;
            state.notifyEntered();
            // TRACE_STMT occurs inside sqlite3_step after VDBE activation. An
            // actual interrupt, not elapsed time, releases this test barrier.
            // Deadline is failure containment, never evidence of cancellation.
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(15);
            auto *db = sqlite3_db_handle(stmt);
            while (!sqlite3_is_interrupted(db)) {
                if (std::chrono::steady_clock::now() >= deadline) {
                    state.timedOut = true;
                    return 0;
                }
                std::this_thread::yield();
            }
            state.interrupted = true;
        } catch (...) {
            // Never throw through SQLite's C callback. The scalar result fails
            // the XCTest instead; normal completion cannot satisfy the test.
            state.timedOut = true;
        }
        return 0;
    }
};
} // namespace orot_test
#endif
