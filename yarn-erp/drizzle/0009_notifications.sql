CREATE TABLE notifications (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL,
 event TEXT NOT NULL,
 object_type TEXT NOT NULL,
 object_id TEXT NOT NULL,
 label TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read')),
 created_by TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 read_at INTEGER,
 since INTEGER,
 CHECK(event != 'reminder' OR since IS NOT NULL)
);
CREATE INDEX notifications_user_status_created ON notifications(user_id,status,created_at DESC);
CREATE INDEX notifications_object_event ON notifications(object_type,object_id,event);
CREATE UNIQUE INDEX notification_reminder_episode ON notifications(object_type,object_id,since,user_id) WHERE event='reminder';
