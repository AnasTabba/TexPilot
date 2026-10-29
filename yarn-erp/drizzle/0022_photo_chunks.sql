-- Photo storage in D1 for when no R2 bucket is bound: each object is split into chunks under D1's value size limit.
CREATE TABLE photo_chunks (
 object_key TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq >= 0), body TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
 PRIMARY KEY(object_key, seq)
);
