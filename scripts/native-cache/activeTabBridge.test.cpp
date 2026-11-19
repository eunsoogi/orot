#include "OPBridge.hpp"
#include <cassert>
#include <iostream>
using namespace opsqlite;

static int argumentCount = 5;
static char executable[] = "fixture", key[] = "-OROT_TEST_SCENARIO";
static char scenario[] = "active-tab-workload", sessionKey[] = "-OROT_WORKLOAD_SESSION";
static char session[] = "01234567-89ab-cdef-0123-456789abcdef";
static char *arguments[] = {executable, key, scenario, sessionKey, session, nullptr};
extern "C" int *_NSGetArgc() { return &argumentCount; }
extern "C" char ***_NSGetArgv() {
    static char **value = arguments;
    return &value;
}
extern "C" unsigned long long mach_absolute_time() {
    static unsigned long long tick = 0;
    return ++tick;
}

int main() {
    sqlite3 *database = nullptr;
    assert(sqlite3_open(":memory:", &database) == SQLITE_OK);
    assert(sqlite3_exec(database,
                        "CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES(3),(1),(2);",
                        nullptr, nullptr, nullptr) == SQLITE_OK);
    const std::string sql = "SELECT value FROM sample WHERE value >= ? ORDER BY value";
    const std::vector<JSVariant> bindings{1};
    const auto plain = opsqlite_execute(database, sql, &bindings);
    const auto tagged =
        opsqlite_execute(database, "/* orot-synthetic-active-tab */" + sql, &bindings);
    assert(plain.column_names == tagged.column_names);
    assert(plain.rows.size() == 3 && tagged.rows.size() == 3);
    for (size_t index = 0; index < plain.rows.size(); ++index) {
        assert(std::get<double>(plain.rows[index][0]) == static_cast<double>(index + 1));
        assert(std::get<double>(tagged.rows[index][0]) == std::get<double>(plain.rows[index][0]));
    }
    assert(sqlite3_close(database) == SQLITE_OK);
    std::cout << "PASS: tagged query preserves rows and order\n";
}
