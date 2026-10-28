/** D1-compatible local binding. The same queries run locally and on Cloudflare. */
export function sqliteBinding(database) {
  function statement(sql, args = []) {
    const runSync = () => {
      const result = database.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(result.changes) } };
    };
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return database.prepare(sql).get(...args) ?? null; },
      async all() { return { success: true, results: database.prepare(sql).all(...args) }; },
      runSync,
      async run() { return runSync(); },
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const output = [];
        for (const query of statements) output.push(query.runSync());
        database.exec('COMMIT');
        return output;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
