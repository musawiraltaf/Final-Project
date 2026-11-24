import {
  hex,
  bytes,
  random,
  scalar,
  fingerprint,
  publicParameters,
  extractKey,
  validateEnvelope,
} from "./public/ibe.js";
import { hmac } from "./public/vendor/hashes/hmac.js";
import { sha512 } from "./public/vendor/hashes/sha2.js";

const roles = [
  ["hq@company.local", "hq"],
  ["alice@company.local", "employee"],
  ["bob@company.local", "employee"],
];
const activeAccount = "NOT EXISTS (SELECT 1 FROM revoked_accounts r WHERE r.workspace=accounts.workspace AND r.email=accounts.email)";
const utf8 = new TextEncoder();
export const identity = (workspace, email, version) =>
  JSON.stringify(["dispatch-v1", workspace, email, version]);
const now = () => new Date().toISOString();
class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function requireValue(condition, status, message) {
  if (!condition) throw new RequestError(status, message);
}
const response = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function master(root, id) {
  requireValue(
    /^[0-9a-f]{64}$/.test(root),
    503,
    "Key authority is unavailable.",
  );
  return scalar(
    hmac(sha512, bytes(root), utf8.encode("Dispatch/workspace/" + id)),
  );
}
async function body(request) {
  requireValue(
    request.headers.get("content-type")?.split(";")[0] === "application/json",
    415,
    "JSON required.",
  );
  const reader = request.body?.getReader();
  requireValue(reader, 400, "Request body required.");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 21000) {
      await reader.cancel();
      throw new RequestError(413, "Request too large.");
    }
    chunks.push(value);
  }
  try {
    const data = JSON.parse(await new Blob(chunks).text());
    if (!data || Array.isArray(data) || typeof data !== "object") throw Error();
    return data;
  } catch {
    throw new RequestError(400, "Invalid request.");
  }
}
export async function handle(request, env) {
  try {
    const route = new URL(request.url).pathname;
    const method = request.method;
    const post = method === "POST";
    const db = env.DB;
    const sql = (q, ...args) => db.prepare(q).bind(...args);
    if (post && (route === "/api/workspaces" || route === "/api/login")) {
      const interval = route === "/api/workspaces" ? 86400000 : 900000;
      const limit = route === "/api/workspaces" ? 60 : 120;
      const time = Date.now(),
        end = (Math.floor(time / interval) + 1) * interval;
      const peer =
        env.PEER || request.headers.get("cf-connecting-ip") || "shared";
      const bucket = fingerprint(route + "|" + end + "|" + peer);
      await sql("DELETE FROM request_limits WHERE expires_at<=?", time).run();
      const row = await sql(
        "INSERT INTO request_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count",
        bucket,
        end,
        limit,
      ).first();
      requireValue(row, 429, "Request limit reached. Try again later.");
    }
    if (route === "/api/workspaces" && post) {
      await body(request);
      const workspace = hex(random(12)),
        created = now();
      const publicKey = publicParameters(master(env.MASTER_KEY, workspace));
      const accounts = roles.map(([email, role]) => ({
        email,
        role,
        pass: hex(random(18)),
      }));
      await db.batch([
        sql(
          "INSERT INTO workspaces VALUES(?,?,?)",
          workspace,
          publicKey,
          created,
        ),
        ...accounts.map((a) =>
          sql(
            "INSERT INTO accounts(workspace,email,role,credential_hash) VALUES(?,?,?,?)",
            workspace,
            a.email,
            a.role,
            fingerprint(a.pass),
          ),
        ),
      ]);
      return response({ workspace, accounts }, 201);
    }
    if (route === "/api/login" && post) {
      const { workspace, email, pass } = await body(request);
      requireValue(
        [workspace, email, pass].every((x) => typeof x === "string"),
        400,
        "Missing credentials.",
      );
      const account = await sql(
        `SELECT role FROM accounts WHERE workspace=? AND email=? AND credential_hash=? AND ${activeAccount}`,
        workspace,
        email.trim().toLowerCase(),
        fingerprint(pass),
      ).first();
      requireValue(
        account,
        401,
        "The workspace, identity or access code is incorrect.",
      );
      const token = hex(random(32));
      await db.batch([
        sql("DELETE FROM sessions WHERE expires_at<=?", Date.now()),
        sql(
          "INSERT INTO sessions VALUES(?,?,?,?)",
          fingerprint(token),
          workspace,
          email.trim().toLowerCase(),
          Date.now() + 4 * 3600000,
        ),
      ]);
      return response({ token });
    }
    const bearer = request.headers.get("authorization") || "";
    requireValue(
      /^Bearer [0-9a-f]{64}$/.test(bearer),
      401,
      "Sign in to continue.",
    );
    const tokenHash = fingerprint(bearer.slice(7));
    const user = await sql(
      "SELECT a.workspace,a.email,a.role,a.version,a.issued_at,w.public_key FROM sessions s JOIN accounts a ON a.email=s.email AND a.workspace=s.workspace JOIN workspaces w ON w.id=s.workspace WHERE s.token_hash=? AND s.expires_at>? AND NOT EXISTS (SELECT 1 FROM revoked_accounts r WHERE r.workspace=a.workspace AND r.email=a.email)",
      tokenHash,
      Date.now(),
    ).first();
    requireValue(user, 401, "Session expired. Sign in again.");
    const { workspace, email, role } = user;
    if (route === "/api/logout" && post) {
      await sql("DELETE FROM sessions WHERE token_hash=?", tokenHash).run();
      return response({ ok: true });
    }
    if (route === "/api/state" && method === "GET") {
      const rows =
        role === "hq"
          ? await sql(
              `SELECT email,version,issued_at FROM accounts WHERE workspace=? AND role='employee' AND ${activeAccount} ORDER BY email`,
              workspace,
            ).all()
          : { results: [] };
      const messages =
        role === "hq"
          ? await sql(
              "SELECT * FROM directives WHERE workspace=? ORDER BY created_at DESC LIMIT 100",
              workspace,
            ).all()
          : await sql(
              "SELECT * FROM directives WHERE workspace=? AND recipient=? ORDER BY created_at DESC LIMIT 100",
              workspace,
              email,
            ).all();
      return response({
        user,
        recipients: rows.results,
        messages: messages.results.map((m) => ({
          ...m,
          envelope: JSON.parse(m.envelope),
        })),
      });
    }
    if (post && route === "/api/employees") {
      requireValue(role === "hq", 403, "Headquarters access required.");
      const data = await body(request);
      const recipient = typeof data.recipient === "string" ? data.recipient.trim().toLowerCase() : "";
      requireValue(/^[a-z0-9][a-z0-9._+@-]{0,127}$/.test(recipient), 400,
        "Use 1 to 128 letters, digits, or the symbols . _ + @ - for the badge ID.");
      const pass = hex(random(18));
      const row = await sql(
        "INSERT INTO accounts(workspace,email,role,credential_hash) VALUES(?,?,'employee',?) ON CONFLICT(workspace,email) DO NOTHING RETURNING email",
        workspace, recipient, fingerprint(pass),
      ).first();
      requireValue(row, 409, "This badge ID is already reserved in this workspace.");
      return response({ workspace, recipient, pass }, 201);
    }
    if (post && route === "/api/revoke") {
      requireValue(role === "hq", 403, "Headquarters access required.");
      const { recipient } = await body(request);
      requireValue(typeof recipient === "string", 400, "Choose an employee.");
      const account = await sql(
        "SELECT email FROM accounts WHERE workspace=? AND email=? AND role='employee'",
        workspace, recipient,
      ).first();
      requireValue(account, 404, "Employee unavailable.");
      await db.batch([
        sql("INSERT INTO revoked_accounts VALUES(?,?,?) ON CONFLICT(workspace,email) DO NOTHING", workspace, recipient, now()),
        sql("DELETE FROM sessions WHERE workspace=? AND email=?", workspace, recipient),
      ]);
      return response({ ok: true });
    }
    if (route === "/api/keys" && post) {
      const data = await body(request);
      requireValue(
        role === "employee" && (!data.email || data.email === email),
        403,
        "Key issuance is restricted to the signed-in employee.",
      );
      requireValue(
        publicParameters(master(env.MASTER_KEY, workspace)) === user.public_key,
        503,
        "Restore the matching authority key.",
      );
      const issued = now();
      const row = await sql(
        `UPDATE accounts SET issued_at=COALESCE(issued_at,?) WHERE workspace=? AND email=? AND version=? AND ${activeAccount} RETURNING issued_at`,
        issued,
        workspace,
        email,
        user.version,
      ).first();
      requireValue(row, 409, "Key version changed. Refresh and retry.");
      return response({
        version: user.version,
        issued_at: row.issued_at,
        key: extractKey(
          master(env.MASTER_KEY, workspace),
          identity(workspace, email, user.version),
        ),
      });
    }
    if (route === "/api/rotate" && post) {
      requireValue(role === "hq", 403, "Headquarters access required.");
      const { recipient, version } = await body(request);
      const row = await sql(
        `UPDATE accounts SET version=version+1,issued_at=NULL WHERE workspace=? AND email=? AND role='employee' AND version=? AND ${activeAccount} RETURNING version`,
        workspace,
        recipient,
        version,
      ).first();
      requireValue(row, 409, "Identity or version changed.");
      return response(row);
    }
    if (route === "/api/directives" && post) {
      requireValue(role === "hq", 403, "Headquarters access required.");
      const { recipient, version, envelope } = await body(request);
      requireValue(
        typeof recipient === "string" &&
          Number.isSafeInteger(version) &&
          validateEnvelope(envelope),
        400,
        "Invalid encrypted envelope.",
      );
      const id = crypto.randomUUID(),
        created = now();
      const row = await sql(
        `INSERT INTO directives SELECT ?,workspace,email,version,?,? FROM accounts WHERE workspace=? AND email=? AND role='employee' AND version=? AND ${activeAccount} RETURNING id`,
        id,
        JSON.stringify(envelope),
        created,
        workspace,
        recipient,
        version,
      ).first();
      requireValue(
        row,
        409,
        "Recipient key version changed. Refresh and encrypt again.",
      );
      return response({ id, created }, 201);
    }
    throw new RequestError(404, "Endpoint unavailable.");
  } catch (e) {
    if (!e.status) console.error("API failure", e.name);
    return response(
      { error: e.status ? e.message : "Service unavailable." },
      e.status || 500,
    );
  }
}
