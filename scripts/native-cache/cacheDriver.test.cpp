
#include "OrotCachedExecute.hpp"
#include "OrotPeriodQueries.hpp"
#include "PeriodRemovalAllowlist.hpp"
#include <cassert>
#include <iostream>
using namespace opsqlite;
namespace opsqlite {
BridgeResult opsqlite_execute(sqlite3 *, const std::string &, const std::vector<JSVariant> *);
}
void exec(sqlite3 *db, const std::string &sql) {
    assert(sqlite3_exec(db, sql.c_str(), nullptr, nullptr, nullptr) == SQLITE_OK);
}
size_t compare(sqlite3 *db, OrotStatementCache &cache, bool expectMarker) {
    size_t matched = 0, measurementMatches = 0;
    for (const auto &sql : periodRemovalAllowlist)
        for (const char *topic : {"measurements", "activity", "sleep", "symptoms", "medications"}) {
            const std::vector<JSVariant> params = {std::string(topic), std::string(""),
                                                   std::string("~")};
            auto baseline = opsqlite_execute(db, sql, &params);
            auto candidate = orotExecuteCached(db, sql, &params, cache);
            assert(candidate.column_names == baseline.column_names);
            assert(candidate.affectedRows == baseline.affectedRows &&
                   candidate.insertId == baseline.insertId);
            assert(candidate.rows.size() == baseline.rows.size());
            matched += candidate.rows.size();
            if (std::string(topic) == "measurements")
                measurementMatches += candidate.rows.size();
            for (size_t r = 0; r < baseline.rows.size(); ++r) {
                assert(candidate.rows[r].size() == baseline.rows[r].size());
                for (size_t c = 0; c < baseline.rows[r].size(); ++c)
                    assert(std::get<std::string>(candidate.rows[r][c]) ==
                           std::get<std::string>(baseline.rows[r][c]));
            }
        }
    assert((measurementMatches > 0) == expectMarker);
    return matched;
}
int main() {
    sqlite3 *db = nullptr;
    assert(sqlite3_open(":memory:", &db) == SQLITE_OK);
    for (const std::string table : {"health_observations", "medication_definitions",
                                    "medication_assertions", "dose_events", "symptom_entries"}) {
        exec(db, "CREATE TABLE " + table +
                     " (id TEXT, payload_json TEXT, effective_at TEXT, ingested_at TEXT)");
        exec(db, "CREATE INDEX " + table + "_period_singleton ON " + table + "(id)");
        exec(db, "CREATE INDEX " + table + "_period_fallback ON " + table + "(effective_at)");
        exec(db, "INSERT INTO " + table +
                     " VALUES('record', "
                     "'{\"concept\":\"heart_rate\",\"observationKind\":\"measurement\",\"value\":{"
                     "\"kind\":\"quantity\",\"amount\":70,\"unit\":\"bpm\"},\"provenance\":{"
                     "\"sourceRecordIds\":[\"source\"]}}', '2026-10-02T00:00:00Z', "
                     "'2026-10-03T00:00:00Z')");
    }
    exec(db, "CREATE TABLE source_deletion_tombstones(source_id TEXT); CREATE TABLE "
             "agent_memory_removed_sources(source_id TEXT); CREATE TABLE "
             "typed_deletion_markers(marker_table TEXT, source_id TEXT, kind TEXT); CREATE TABLE "
             "transcript_segments(id TEXT, payload_json TEXT); CREATE INDEX "
             "transcript_segments_recording_idx ON transcript_segments ("
             "json_extract(payload_json, '$.recordingSourceId'), "
             "json_extract(payload_json, '$.segmentOrdinal'), "
             "json_extract(payload_json, '$.revision'))");

    {
        OrotStatementCache cache(db, orotCacheEligible);
        assert(compare(db, cache, false) == 0);
        exec(db, "INSERT INTO source_deletion_tombstones VALUES('record'); INSERT INTO "
                 "agent_memory_removed_sources VALUES('source')");
        assert(compare(db, cache, true) > 0);
        exec(db, "BEGIN; DELETE FROM source_deletion_tombstones; DELETE FROM "
                 "agent_memory_removed_sources");
        assert(compare(db, cache, false) == 0);
        exec(db, "ROLLBACK");
        assert(compare(db, cache, true) > 0);
        exec(db, "ALTER TABLE symptom_entries ADD COLUMN extra TEXT");
        assert(compare(db, cache, true) > 0);
        // Unrecognized SQL and non-three-arity requests still use the original executor.
        const std::vector<JSVariant> params = {std::string("fallback")};
        auto fallback = orotExecuteCached(db, "SELECT ? AS test", &params, cache);
        assert(std::get<std::string>(fallback.rows[0][0]) == "fallback");
        cache.clear();
        assert(!sqlite3_next_stmt(db, nullptr));
    }
    assert(sqlite3_close(db) == SQLITE_OK);
    std::cout << "PASS: original OPBridge vs cached executor, 400 result+metadata comparisons and "
                 "fallback\n";
}
