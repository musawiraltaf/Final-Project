import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
const base = fileURLToPath(new URL(".", import.meta.url));
export function openStore(data: string) {
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const secretPath = join(data, "authority.key");
  if (!process.env.MASTER_KEY && !existsSync(secretPath)) {
    if (existsSync(join(data, "dispatch.sqlite")))
      throw Error("Restore the matching authority key before starting.");
    writeFileSync(secretPath, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const secret =
    process.env.MASTER_KEY || readFileSync(secretPath, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(secret)) throw Error("Invalid authority key.");
  const database = new DatabaseSync(join(data, "dispatch.sqlite"));
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  database.exec(readFileSync(join(base, "schema.sql"), "utf8"));
  function statement(query: string, values: SQLInputValue[]) {
    const stmt = database.prepare(query);
    return {
      run: () => stmt.run(...values),
      first: () => stmt.get(...values) ?? null,
      all: () => ({ results: stmt.all(...values) }),
    };
  }
  const DB = {
    prepare: (query: string) => ({
      bind: (...values: SQLInputValue[]) => statement(query, values),
    }),
    batch: (items: ReturnType<typeof statement>[]) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = items.map((item) => item.run());
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { DB, MASTER_KEY: secret, close: () => database.close() };
}
