#include "OrotStatementCache.hpp"
#include <unordered_set>
using opsqlite::OrotStatementCache;
static std::unordered_set<std::string> allowed;
static bool eligible(const std::string &sql) { return allowed.count(sql) != 0; }
#include <cassert>
#include <cstdlib>
#include <iostream>
#include <new>
static long remaining = -1;
void *operator new(std::size_t size) {
    if (remaining == 0)
        throw std::bad_alloc();
    if (remaining > 0)
        --remaining;
    if (void *p = std::malloc(size))
        return p;
    throw std::bad_alloc();
}
void operator delete(void *p) noexcept { std::free(p); }
void operator delete(void *p, std::size_t) noexcept { std::free(p); }
int main() {
    sqlite3 *db = nullptr;
    assert(sqlite3_open(":memory:", &db) == SQLITE_OK);
    int failures = 0, successes = 0;
    for (const std::string sql :
         {"SELECT ? AS value WHERE ?=? /* sufficient length forces owned SQL allocation */",
          "SELECT value FROM missing_table WHERE ?=? AND ?"}) {
        for (long point = 0; point < 8; ++point) {
            allowed = {sql};
            OrotStatementCache cache(db, eligible);
            remaining = point;
            try {
                if (cache.acquire(sql, 3)) {
                    remaining = -1;
                    cache.abandon();
                    ++successes;
                }
            } catch (const std::bad_alloc &) {
                remaining = -1;
                ++failures;
            } catch (const std::runtime_error &) {
                remaining = -1;
            }
            remaining = -1;
            cache.clear();
            // SQLite allocations are independent of C++ operator new, so this detects
            // leaks specifically at SQL/error-string and entry allocations after prepare.
            assert(sqlite3_next_stmt(db, nullptr) == nullptr);
        }
    }
    assert(failures >= 3 && successes > 0);
    assert(sqlite3_close(db) == SQLITE_OK);
    std::cout << "PASS: allocation-fault cleanup, failures=" << failures
              << " successes=" << successes << '\n';
}
