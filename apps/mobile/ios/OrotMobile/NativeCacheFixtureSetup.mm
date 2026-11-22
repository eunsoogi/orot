#include "NativeCacheFixtureState.h"
#if defined(OROT_TESTS) && TARGET_OS_SIMULATOR
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <array>
namespace orot_test {
bool Fixture::cleanup() {
    if (owner)
        owner->invalidate();
    disposed = true;
    if (directory.empty())
        return true;
    NSString *path = [NSString stringWithUTF8String:directory.c_str()];
    const bool removed = [[NSFileManager defaultManager] removeItemAtPath:path error:nullptr];
    const bool absent = ![[NSFileManager defaultManager] fileExistsAtPath:path];
    if (removed && absent)
        directory.clear();
    return removed && absent;
}
Fixture::~Fixture() {
    // Explicit dispose is asserted. Teardown fallback cannot throw or leave a
    // worker referring to trace storage that is about to be destroyed.
    try {
        cleanup();
    } catch (...) {
    }
}
bool Fixture::verifyReopen(jsi::Runtime &runtime) {
    require(disposed && !directory.empty() && !reopened,
            "Reopen requires a new invalidated fixture");
    reopened = true;
    jsi::Object object(runtime);
    std::string name = "fixture.db";
    auto reopenedOwner = std::make_shared<opsqlite::OPDatabase>(runtime, object, directory, name,
                                                                directory, false, true, key);
    object.setNativeState(runtime, reopenedOwner);
    sqlite3_stmt *stmt = nullptr;
    const int prepared =
        sqlite3_prepare_v2(Access::database(*reopenedOwner),
                           "SELECT count(*) FROM health_observations", -1, &stmt, nullptr);
    const bool valid = prepared == SQLITE_OK && sqlite3_step(stmt) == SQLITE_ROW &&
                       sqlite3_column_int(stmt, 0) == 1;
    sqlite3_finalize(stmt);
    reopenedOwner->invalidate();
    return valid;
}
void seed(sqlite3 *db) {
    const char *sql =
        "CREATE TABLE health_observations(id TEXT,payload_json TEXT,effective_at TEXT,ingested_at "
        "TEXT);"
        "CREATE INDEX health_observations_period_singleton ON health_observations(id);"
        "CREATE INDEX health_observations_period_fallback ON health_observations(effective_at);"
        "CREATE TABLE source_deletion_tombstones(source_id TEXT);"
        "CREATE TABLE agent_memory_removed_sources(source_id TEXT);"
        "CREATE TABLE typed_deletion_markers(marker_table TEXT,source_id TEXT,kind TEXT);"
        "CREATE TABLE transcript_segments(id TEXT,payload_json TEXT);"
        "CREATE INDEX transcript_segments_recording_idx ON transcript_segments ("
        "json_extract(payload_json, '$.recordingSourceId'), "
        "json_extract(payload_json, '$.segmentOrdinal'), json_extract(payload_json, '$.revision'));"
        "INSERT INTO health_observations VALUES('fixture',"
        "'{\"observationKind\":\"measurement\",\"concept\":\"heart_rate\","
        "\"value\":{\"kind\":\"quantity\",\"amount\":70,\"unit\":\"bpm\"}}',"
        "'2026-10-02T00:00:00Z','2026-10-03T00:00:00Z');";
    require(sqlite3_exec(db, sql, nullptr, nullptr, nullptr) == SQLITE_OK,
            "Synthetic schema failed");
}
std::shared_ptr<Fixture> makeFixtureState(jsi::Runtime &rt) {
    require(opsqlite::invoker && opsqlite::generation_alive && opsqlite::generation_alive->load(),
            "Live Hermes database generation required");
    auto state = std::make_shared<Fixture>();
    NSString *directory = [NSTemporaryDirectory()
        stringByAppendingPathComponent:[@"orot-native-owner-"
                                           stringByAppendingString:NSUUID.UUID.UUIDString]];
    require([[NSFileManager defaultManager] createDirectoryAtPath:directory
                                      withIntermediateDirectories:NO
                                                       attributes:nil
                                                            error:nullptr],
            "Fixture directory failed");
    state->directory = directory.UTF8String;
    std::array<unsigned char, 32> bytes;
    require(SecRandomCopyBytes(kSecRandomDefault, bytes.size(), bytes.data()) == errSecSuccess,
            "Synthetic key generation failed");
    std::string &key = state->key;
    constexpr char digits[] = "0123456789abcdef";
    for (auto byte : bytes) {
        key += digits[byte >> 4];
        key += digits[byte & 15];
    }
    // Construct the actual production owner, without accepting a potentially
    // replaced global proxy or any caller-supplied native state.
    state->raw = std::make_shared<jsi::Object>(rt);
    std::string name = "fixture.db";
    state->owner = std::make_shared<opsqlite::OPDatabase>(
        rt, *state->raw, state->directory, name, state->directory, false, false, state->key);
    state->raw->setNativeState(rt, state->owner);
    require(state->raw->getNativeState<opsqlite::OPDatabase>(rt) == state->owner,
            "Actual OPDatabase NativeState required");
    auto *db = Access::database(*state->owner);
    sqlite3_stmt *cipher = nullptr;
    const int prepared = sqlite3_prepare_v2(db, "PRAGMA cipher_version", -1, &cipher, nullptr);
    const bool encrypted = prepared == SQLITE_OK && sqlite3_step(cipher) == SQLITE_ROW &&
                           sqlite3_column_bytes(cipher, 0) > 0;
    sqlite3_finalize(cipher);
    require(encrypted, "Actual SQLCipher engine required");
    seed(db);
    require(sqlite3_trace_v2(db, SQLITE_TRACE_STMT | SQLITE_TRACE_CLOSE, NativeCacheTrace::callback,
                             &state->trace) == SQLITE_OK,
            "Trace registration failed");
    return state;
}
} // namespace orot_test
#endif
