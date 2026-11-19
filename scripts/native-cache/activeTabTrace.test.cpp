#include <sqlite3.h>
#include <cassert>
#include <cstring>

static int testArgc = 5;
static char scenarioKey[] = "-OROT_TEST_SCENARIO";
static char scenario[] = "active-tab-workload";
static char sessionKey[] = "-OROT_WORKLOAD_SESSION";
static char session[] = "01234567-89ab-cdef-0123-456789abcdef";
static char executable[] = "fixture";
static char *testArgv[] = {executable, scenarioKey, scenario, sessionKey, session, nullptr};
extern "C" int *_NSGetArgc() { return &testArgc; }
extern "C" char ***_NSGetArgv() {
    static char **value = testArgv;
    return &value;
}
extern "C" unsigned long long mach_absolute_time() {
    static unsigned long long tick = 0;
    return ++tick;
}
#include "OrotActiveTabTrace.hpp"

int main() {
    const std::string marked = "/* orot-synthetic-active-tab */SELECT 1";
    auto first = orot_active_tab::begin(marked);
    assert(first.sequence > 0 && first.started > 0);
    assert(std::strcmp(first.run.data(), session) == 0);
    orot_active_tab::TraceScope trace;
    orot_active_tab::end(trace, first, SQLITE_DONE);
    assert(trace.count == 1 && trace.records[0].status == SQLITE_DONE);
    assert(orot_active_tab::begin("SELECT 1").sequence == 0);
    scenario[0] = 'x';
    assert(orot_active_tab::begin(marked).sequence == 0);
    scenario[0] = 'a';
    session[0] = 'z';
    assert(orot_active_tab::begin(marked).sequence == 0);
}
