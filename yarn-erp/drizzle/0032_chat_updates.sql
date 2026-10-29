-- Persist source snapshots on staff chat messages. Keep the legacy ref_type/ref_id/ref_label
-- columns for existing batch cards; other reference kinds live in ref_json.
ALTER TABLE chat_messages ADD COLUMN ref_json TEXT CHECK(ref_json IS NULL OR json_valid(ref_json));
ALTER TABLE chat_messages ADD COLUMN request_hash TEXT;
