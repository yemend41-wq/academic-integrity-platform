import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function database(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)",
  );
  for (const f of readdirSync("drizzle")
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    if (!db.prepare("SELECT name FROM local_migrations WHERE name=?").get(f)) {
      db.exec(readFileSync("drizzle/" + f, "utf8"));
      db.prepare("INSERT INTO local_migrations VALUES(?)").run(f);
    }
  }
  function prepare(sql, args = []) {
    const st = () => db.prepare(sql);
    return {
      bind(...a) {
        return prepare(sql, a);
      },
      async first() {
        return st().get(...args) || null;
      },
      async all() {
        return { results: st().all(...args) };
      },
      async run() {
        return { meta: st().run(...args) };
      },
    };
  }
  return {
    prepare,
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const result = [];
        for (const st of stmts) result.push(await st.run());
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
