-- 0027_chat.sql: team chat. One shared "team" thread per workspace plus 1:1 direct threads.
-- Additive only. A message holds text, a photo (object stored in BUCKET under photo_key) or a batch reference, or any mix.
CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK(kind IN ('team','direct')), key TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_message_at INTEGER,
  UNIQUE(workspace_id, key)
);
CREATE TABLE chat_members (
  thread_id TEXT NOT NULL REFERENCES chat_threads(id), user_id TEXT NOT NULL REFERENCES users(id),
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(thread_id, user_id)
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  thread_id TEXT NOT NULL REFERENCES chat_threads(id), user_id TEXT NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  photo_key TEXT, photo_type TEXT,
  ref_type TEXT CHECK(ref_type IS NULL OR ref_type='lot'), ref_id TEXT, ref_label TEXT,
  created_at INTEGER NOT NULL,
  CHECK(body<>'' OR photo_key IS NOT NULL OR ref_type IS NOT NULL)
);
CREATE INDEX chat_messages_thread ON chat_messages(thread_id, created_at);
