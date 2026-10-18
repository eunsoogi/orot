// Compile with the pinned amalgamation on the include path. Only in-memory,
// synthetic databases are used; setting internal counters avoids billions of writes.
#include "sqlite3.c"
#include <stdio.h>

int main(void) {
    sqlite3 *db = NULL;
    char *error = NULL;
    if (sqlite3_open(":memory:", &db) != SQLITE_OK)
        return 2;
    if (sqlite3_exec(db,
                     "CREATE TABLE t(value); INSERT INTO t VALUES(42); ATTACH ':memory:' AS copy;",
                     NULL, NULL, &error) != SQLITE_OK)
        return 3;
    const sqlite3_int64 changes = 4294967301LL;
    const sqlite3_int64 total = 8589934601LL;
    db->nChange = changes;
    db->nTotalChange = total;
    int result = sqlite3_exec(db, "SELECT sqlcipher_export('copy');", NULL, NULL, &error);
    printf("export=%d changes=%lld total=%lld\n", result, sqlite3_changes64(db),
           sqlite3_total_changes64(db));
    int passed = result == SQLITE_OK && sqlite3_changes64(db) == changes &&
                 sqlite3_total_changes64(db) == total;
    sqlite3_free(error);
    sqlite3_close(db);
    return passed ? 0 : 1;
}
