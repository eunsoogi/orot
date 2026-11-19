#include "OrotStatementCache.hpp"
#include <unordered_set>
using opsqlite::OrotStatementCache;
static std::unordered_set<std::string> allowed;
static bool eligible(const std::string &sql) { return allowed.count(sql) != 0; }
#include <cassert>
#include <iostream>
static void fail(sqlite3_context *ctx, int, sqlite3_value **) {
    sqlite3_result_error(ctx, "synthetic failure", -1);
}
static int stop(void *) { return 1; }
static void exec(sqlite3 *db, const char *q) {
    assert(sqlite3_exec(db, q, nullptr, nullptr, nullptr) == SQLITE_OK);
}
int main() {
    sqlite3 *db = nullptr;
    assert(sqlite3_open(":memory:", &db) == SQLITE_OK);
    {
        const std::string missing = "SELECT value FROM absent WHERE ?=? AND ?";
        allowed = {missing};
        OrotStatementCache cache(db, eligible);
        bool threw = false;
        try {
            cache.acquire(missing, 3);
        } catch (const std::runtime_error &) {
            threw = true;
        }
        assert(threw && cache.size() == 0 && !sqlite3_next_stmt(db, nullptr));
    }
    {
        const std::string q = "SELECT synthetic_error(?,?,?)";
        sqlite3_create_function(db, "synthetic_error", 3, SQLITE_UTF8, nullptr, fail, nullptr,
                                nullptr);
        allowed = {q};
        OrotStatementCache cache(db, eligible);
        auto *s = cache.acquire(q, 3);
        assert(s);
        assert(sqlite3_step(s) == SQLITE_ERROR);
        assert(cache.release(SQLITE_ERROR) == SQLITE_ERROR);
        assert(cache.size() == 0);
    }
    {
        const std::string q = "WITH RECURSIVE n(x) AS (SELECT ? UNION ALL SELECT x+1 FROM n WHERE "
                              "x < ?) SELECT sum(x) + ? FROM n";
        allowed = {q};
        OrotStatementCache cache(db, eligible);
        auto *s = cache.acquire(q, 3);
        assert(s);
        sqlite3_bind_int(s, 1, 1);
        sqlite3_bind_int(s, 2, 10000);
        sqlite3_bind_int(s, 3, 0);
        sqlite3_progress_handler(db, 1, stop, nullptr);
        assert(sqlite3_step(s) == SQLITE_INTERRUPT);
        assert(cache.release(SQLITE_INTERRUPT) == SQLITE_INTERRUPT);
        sqlite3_progress_handler(db, 0, nullptr, nullptr);
        assert(cache.size() == 0);
        s = cache.acquire(q, 3);
        assert(s);
        sqlite3_bind_int(s, 1, 1);
        sqlite3_bind_int(s, 2, 2);
        sqlite3_bind_int(s, 3, 0);
        assert(sqlite3_step(s) == SQLITE_ROW && sqlite3_column_int(s, 0) == 3);
        assert(sqlite3_step(s) == SQLITE_DONE);
        assert(cache.release(SQLITE_DONE) == SQLITE_OK);
    }
    {
        exec(db, "CREATE TABLE meta(a INTEGER); INSERT INTO meta VALUES(1)");
        const std::string q = "SELECT * FROM meta WHERE ?=? AND ?";
        allowed = {q};
        OrotStatementCache cache(db, eligible);
        for (int columns : {1, 2}) {
            auto *s = cache.acquire(q, 3);
            assert(s);
            for (int i = 1; i <= 3; i++)
                sqlite3_bind_int(s, i, 1);
            assert(sqlite3_step(s) == SQLITE_ROW);
            // Read metadata AFTER first step, which performs automatic schema reprepare.
            assert(sqlite3_column_count(s) == columns);
            assert(sqlite3_step(s) == SQLITE_DONE);
            assert(cache.release(SQLITE_DONE) == SQLITE_OK);
            if (columns == 1)
                exec(db, "ALTER TABLE meta ADD COLUMN b TEXT");
        }
    }
    assert(!sqlite3_next_stmt(db, nullptr));
    assert(sqlite3_close(db) == SQLITE_OK);
    std::cout
        << "PASS: prepare error not retried, step error, interrupt, recovery, metadata reprepare\n";
}
