#include "OrotStatementCache.hpp"
#include <unordered_set>
using opsqlite::OrotStatementCache;
static std::unordered_set<std::string> allowed;
static bool eligible(const std::string &sql) { return allowed.count(sql) != 0; }
#include <cassert>
#include <iostream>
#include <vector>

const std::string query = "SELECT value FROM records WHERE id = ? AND ? = ?";
void exec(sqlite3 *db, const char *sql) {
    assert(sqlite3_exec(db, sql, nullptr, nullptr, nullptr) == SQLITE_OK);
}
std::vector<std::string> run(OrotStatementCache &cache, const std::string &sql = query) {
    auto *s = cache.acquire(sql, 3);
    assert(s);
    try {
        assert(sqlite3_bind_int(s, 1, 1) == SQLITE_OK);
        assert(sqlite3_bind_int(s, 2, 2) == SQLITE_OK);
        assert(sqlite3_bind_int(s, 3, 2) == SQLITE_OK);
        std::vector<std::string> rows;
        int rc;
        while ((rc = sqlite3_step(s)) == SQLITE_ROW)
            rows.emplace_back(reinterpret_cast<const char *>(sqlite3_column_text(s, 0)));
        assert(cache.release(rc) == SQLITE_OK);
        return rows;
    } catch (...) {
        cache.abandon();
        throw;
    }
}
int main() {
    sqlite3 *db = nullptr;
    assert(sqlite3_open(":memory:", &db) == SQLITE_OK);
    exec(db, "CREATE TABLE records(id INTEGER, value TEXT); INSERT INTO records VALUES(1,'first')");
    {
        const auto second = query + " /* second */";
        allowed = {query, second};
        OrotStatementCache cache(db, eligible, 1);
        assert(run(cache) == std::vector<std::string>{"first"});
        assert(run(cache) == std::vector<std::string>{"first"});
        exec(db, "DELETE FROM records"); // an intervening logical write must be observed on the
                                         // next step
        assert(run(cache).empty());
        exec(db, "INSERT INTO records VALUES(1,'next'); BEGIN; DELETE FROM records");
        assert(run(cache).empty());
        exec(db, "ROLLBACK");
        assert(run(cache) == std::vector<std::string>{"next"});
        exec(db, "ALTER TABLE records ADD COLUMN extra TEXT");
        assert(run(cache) == std::vector<std::string>{"next"}); // automatic schema reprepare
        assert(cache.acquire(query, 2) ==
               nullptr); // original missing/extra binding semantics via fallback
        assert(cache.acquire(query + " ", 3) == nullptr); // exact allowlist
        auto *s = cache.acquire(query, 3);
        assert(s);
        assert(sqlite3_bind_int(s, 4, 9) == SQLITE_RANGE);
        assert(cache.release(SQLITE_RANGE) == SQLITE_RANGE);
        assert(cache.size() == 0);
        assert(run(cache) == std::vector<std::string>{"next"});
        s = cache.acquire(query, 3);
        assert(s);
        assert(sqlite3_step(s) == SQLITE_DONE); // all old bindings cleared; NULLs cannot match
        assert(cache.release(SQLITE_DONE) == SQLITE_OK);
        assert(run(cache, second) == std::vector<std::string>{"next"});
        assert(cache.size() == 1);
        s = cache.acquire(second, 3);
        assert(s);
        cache.abandon();
        assert(cache.size() == 0);
        assert(run(cache) == std::vector<std::string>{"next"});
        cache.clear();
        assert(sqlite3_next_stmt(db, nullptr) == nullptr);
    }
    for (auto sql : std::vector<std::string>{"DELETE FROM records WHERE id=? AND ?=?",
                                             query + "; SELECT 1", "SELECT ?"}) {
        allowed = {sql};
        OrotStatementCache cache(db, eligible);
        assert(cache.acquire(sql, 3) == nullptr);
        assert(sqlite3_next_stmt(db, nullptr) == nullptr);
    }
    {
        allowed = {query};
        OrotStatementCache cache(db, eligible, 32, 512 * 1024, 1);
        assert(cache.acquire(query, 3) ==
               nullptr); // compiled statement memory budget, not just SQL bytes
        assert(sqlite3_next_stmt(db, nullptr) == nullptr);
    }
    assert(sqlite3_close(db) == SQLITE_OK);
    std::cout << "PASS: equality, interleave, rollback, schema, bindings, eviction, eligibility, "
                 "memory and close\n";
}
