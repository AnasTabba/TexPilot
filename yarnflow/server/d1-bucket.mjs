/** The subset of the R2 bucket API the app uses (put/get/delete), stored in D1 when no BUCKET binding exists. */
const CHUNK = 1024 * 1024; // D1 caps a single value at about 2 MB; base64 makes a 1 MB chunk about 1.4 MB.
// Base64 text binds the same way in D1 and node:sqlite (blob binding types differ between them).
const encode = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };
const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function d1Bucket(db) {
  return {
    async put(key, bytes, options = {}) {
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), type = options.httpMetadata?.contentType ?? '', now = Date.now();
      const statements = [db.prepare('DELETE FROM photo_chunks WHERE object_key=?').bind(key)];
      for (let seq = 0, at = 0; at < data.length || seq === 0; seq++, at += CHUNK)
        statements.push(db.prepare('INSERT INTO photo_chunks(object_key,seq,body,content_type,created_at) VALUES(?,?,?,?,?)').bind(key, seq, encode(data.subarray(at, at + CHUNK)), type, now));
      await db.batch(statements);
    },
    async get(key) {
      const { results } = await db.prepare('SELECT body FROM photo_chunks WHERE object_key=? ORDER BY seq').bind(key).all();
      if (!results.length) return null;
      const parts = results.map(row => decode(row.body)), body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0; for (const part of parts) { body.set(part, at); at += part.length; }
      return { body };
    },
    async delete(key) { await db.prepare('DELETE FROM photo_chunks WHERE object_key=?').bind(key).run(); },
  };
}
