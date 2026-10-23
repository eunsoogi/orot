// Exercise the installed engine's internal wide-value boundaries without creating
// billions of rows or allocating gigabytes. Public SQL drives the ntile callback.
#include "sqlite3.c"
#include <stdio.h>

static void seed_ntile(sqlite3_context *context, int count, sqlite3_value **values) {
    (void)count;
    struct NtileCtx *state = sqlite3_aggregate_context(context, sizeof(*state));
    if (state == NULL)
        return;
    state->nTotal = sqlite3_value_int64(values[0]);
    state->nParam = sqlite3_value_int64(values[1]);
    state->iRow = sqlite3_value_int64(values[2]);
}

static int check_ntile(sqlite3 *db) {
    sqlite3_stmt *statement = NULL;
    int result = sqlite3_create_function(db, "test_ntile", 3, SQLITE_UTF8, NULL, NULL, seed_ntile,
                                         ntileValueFunc);
    if (result != SQLITE_OK)
        return 0;
    result = sqlite3_prepare_v2(db, "SELECT test_ntile(4294967296, 1, 42)", -1, &statement, NULL);
    int passed = result == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW &&
                 sqlite3_column_int64(statement, 0) == 1;
    printf("ntile-wide-partition=%s actual=%lld expected=1\n", passed ? "pass" : "fail",
           statement != NULL ? sqlite3_column_int64(statement, 0) : -1);
    sqlite3_finalize(statement);
    return passed;
}

static int check_page_references(void) {
    PgHdr page = {0};
    page.nRef = 4294967297LL;
    sqlite3_int64 actual = sqlite3PagerPageRefcount(&page);
    printf("page-reference-count actual=%lld expected=%lld\n", actual, page.nRef);
    return actual == page.nRef;
}

static int check_json_allocation(sqlite3 *db) {
    JsonParse parse = {0};
    parse.db = db;
    // Oversized JSON growth must reach SQLite's allocation cap without wrapping
    // into a small successful allocation at the helper's argument boundary.
    sqlite3_uint64 requested = 4294967297ULL;
    int result = jsonBlobExpand(&parse, requested);
    int passed = result != 0 && parse.oom && parse.aBlob == NULL;
    printf("json-oversized-growth=%s result=%d allocated=%u\n", passed ? "pass" : "fail", result,
           parse.nBlobAlloc);
    sqlite3DbFree(db, parse.aBlob);
    return passed;
}

int main(void) {
    sqlite3 *db = NULL;
    if (sqlite3_open(":memory:", &db) != SQLITE_OK)
        return 2;
    int passed = check_ntile(db);
    passed = check_page_references() && passed;
    passed = check_json_allocation(db) && passed;
    sqlite3_close(db);
    return passed ? 0 : 1;
}
