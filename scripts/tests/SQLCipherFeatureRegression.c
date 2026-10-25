// Exercise the patched engine through SQL and encrypted temporary files. The
// low KDF iteration count is confined to synthetic fixtures, never app settings.
#include "sqlite3.c"
#include <stdio.h>

static int execute(sqlite3 *db, const char *sql) {
    char *error = NULL;
    int result = sqlite3_exec(db, sql, NULL, NULL, &error);
    if (result != SQLITE_OK)
        fprintf(stderr, "SQL error %d: %s\n", result, error ? error : "unknown");
    sqlite3_free(error);
    return result == SQLITE_OK;
}

static int equals(sqlite3 *db, const char *sql, int expected) {
    sqlite3_stmt *statement = NULL;
    int result = sqlite3_prepare_v2(db, sql, -1, &statement, NULL);
    int actual = -1;
    if (result == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW)
        actual = sqlite3_column_int(statement, 0);
    sqlite3_finalize(statement);
    if (actual != expected)
        fprintf(stderr, "Expected %d, received %d for %s\n", expected, actual, sql);
    return actual == expected;
}

static sqlite3 *open_fixture(const char *path, int page_bytes, const char *key) {
    sqlite3 *db = NULL;
    if (sqlite3_open(path, &db) != SQLITE_OK)
        return NULL;
    if (sqlite3_key(db, key, -1) != SQLITE_OK) {
        sqlite3_close(db);
        return NULL;
    }
    char *settings =
        sqlite3_mprintf("PRAGMA cipher_page_size=%d; PRAGMA kdf_iter=1000;", page_bytes);
    int passed = execute(db, settings);
    sqlite3_free(settings);
    if (!passed) {
        sqlite3_close(db);
        return NULL;
    }
    return db;
}

static int check_search(sqlite3 *db) {
    int passed = execute(
        db, "CREATE VIRTUAL TABLE terms USING fts5(words);"
            "INSERT INTO terms(rowid,words) SELECT id, printf('alpha beta token%d 한글',id) FROM t;"
            "CREATE VIRTUAL TABLE compact USING fts5(words,detail=none);"
            "INSERT INTO compact SELECT words FROM terms;"
            "CREATE VIRTUAL TABLE columns USING fts5(words,detail=column);"
            "INSERT INTO columns SELECT words FROM terms;"
            "CREATE VIRTUAL TABLE triples USING fts5(words,tokenize='trigram');"
            "INSERT INTO triples SELECT words FROM terms;"
            "CREATE VIRTUAL TABLE deleted USING fts5(words,content='',contentless_delete=1);"
            "INSERT INTO deleted(rowid,words) SELECT rowid,words FROM terms;"
            "DELETE FROM deleted WHERE rowid<=100;"
            "INSERT INTO deleted(deleted) VALUES('optimize');"
            "INSERT INTO terms(terms,rank) VALUES('secure-delete',1);"
            "UPDATE terms SET words='alpha replacement' WHERE rowid<=50;"
            "INSERT INTO terms(terms) VALUES('optimize');");
    passed = equals(db, "SELECT count(*) FROM terms WHERE terms MATCH 'alpha'", 300) && passed;
    passed = equals(db, "SELECT count(*) FROM compact WHERE compact MATCH 'alpha'", 300) && passed;
    passed = equals(db, "SELECT count(*) FROM columns WHERE columns MATCH 'alpha'", 300) && passed;
    passed = equals(db, "SELECT count(*) FROM triples WHERE triples MATCH 'alpha'", 300) && passed;
    passed = equals(db, "SELECT count(*) FROM deleted WHERE deleted MATCH 'alpha'", 200) && passed;
    passed = equals(db,
                    "SELECT count(*) FROM (SELECT rowid FROM terms WHERE terms MATCH 'alpha' ORDER "
                    "BY rowid DESC)",
                    300) &&
             passed;
    passed = equals(db,
                    "SELECT count(*) FROM (SELECT snippet(terms,0,'[',']','...',4294967296) AS s "
                    "FROM terms WHERE terms MATCH 'alpha') WHERE s LIKE '%[alpha]%'",
                    300) &&
             passed;
    return passed;
}

static int check_file(const char *directory, int page_bytes) {
    char *path = sqlite3_mprintf("%s/pages-%d.db", directory, page_bytes);
    sqlite3 *db = open_fixture(path, page_bytes, "fixture-key");
    if (db == NULL) {
        sqlite3_free(path);
        return 0;
    }
    int passed = sqlite3_db_config(db, SQLITE_DBCONFIG_LOOKASIDE, NULL, 256, 100) == SQLITE_OK;
    passed =
        execute(db, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;"
                    "CREATE TABLE t(id INTEGER PRIMARY KEY, value BLOB);"
                    "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<300) "
                    "INSERT INTO t SELECT x,randomblob(3000) FROM n;"
                    "BEGIN; DELETE FROM t WHERE id<=100; ROLLBACK;"
                    "CREATE INDEX ordered ON t(value);"
                    "PRAGMA user_version=42;") &&
        passed;
    passed = equals(db, "SELECT count(*) FROM t", 300) && passed;
    passed = equals(db, "SELECT length(value) FROM t WHERE id=150", 3000) && passed;
    passed = equals(db, "SELECT count(*) FROM (SELECT value FROM t ORDER BY value)", 300) && passed;
    passed = equals(db, "SELECT sum(bucket) FROM (SELECT ntile(3) OVER(ORDER BY id) bucket FROM t)",
                    600) &&
             passed;
    passed =
        equals(db, "SELECT json_extract(json_set('{\"a\":1}', '$.a', 42), '$.a')", 42) && passed;
    passed = equals(db, "SELECT length(quote(zeroblob(10000)))", 20003) && passed;
    passed = equals(db, "SELECT length(printf('%10000.10000c','x'))", 10000) && passed;
    passed = equals(db, "SELECT length(unhex('616263'))", 3) && passed;
    passed = check_search(db) && passed;
    passed = execute(db, "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;") && passed;
    // Exercise rollback-journal page I/O and the negative-length key API as well.
    passed = execute(db, "BEGIN; DELETE FROM t; ROLLBACK;") && passed;
    passed = sqlite3_rekey(db, "replacement-key", -1) == SQLITE_OK && passed;
    sqlite3_close(db);
    db = open_fixture(path, page_bytes, "replacement-key");
    passed = db != NULL && passed;
    if (db != NULL) {
        passed = equals(db, "SELECT count(*) FROM t", 300) && passed;
        passed = equals(db, "PRAGMA user_version", 42) && passed;
        passed = equals(db, "SELECT count(*) FROM terms WHERE terms MATCH 'alpha'", 300) && passed;
        sqlite3_close(db);
    }
    FILE *file = fopen(path, "rb");
    unsigned char header[16] = {0};
    passed = file != NULL && passed;
    if (file != NULL) {
        passed = fread(header, 1, sizeof(header), file) == sizeof(header) && passed;
        passed = memcmp(header, "SQLite format 3", 15) != 0 && passed;
        fclose(file);
    }
    printf("encrypted-pages=%d features=%s\n", page_bytes, passed ? "pass" : "fail");
    sqlite3_free(path);
    return passed;
}

static int check_small_page_boundary(const char *directory) {
    // SQLite requires >=480 usable bytes. Default SQLCipher HMAC-SHA512 reserves
    // 80, so a 512-byte encrypted page is invalid in the original engine too.
    // Exercise the minimum pager size as plaintext, preserving encryption policy.
    char *path = sqlite3_mprintf("%s/plain-512.db", directory);
    sqlite3 *db = NULL;
    int passed = sqlite3_open(path, &db) == SQLITE_OK;
    if (passed) {
        passed = execute(db, "PRAGMA page_size=512; PRAGMA journal_mode=WAL;"
                             "CREATE TABLE tiny(value); INSERT INTO tiny VALUES(42);"
                             "BEGIN; DELETE FROM tiny; ROLLBACK; PRAGMA wal_checkpoint(TRUNCATE);");
        passed = equals(db, "SELECT value FROM tiny", 42) && passed;
        passed = equals(db, "PRAGMA page_size", 512) && passed;
    }
    sqlite3_close(db);
    sqlite3_free(path);
    printf("plain-pages=512 transaction=%s\n", passed ? "pass" : "fail");
    return passed;
}

int main(int argc, char **argv) {
    if (argc != 2)
        return 2;
    const int sizes[] = {1024, 4096, 65536};
    int passed = check_small_page_boundary(argv[1]);
    for (size_t index = 0; index < sizeof(sizes) / sizeof(sizes[0]); index++)
        passed = check_file(argv[1], sizes[index]) && passed;
    return passed ? 0 : 1;
}
