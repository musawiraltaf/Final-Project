import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../database.ts";
import { handle } from "../api.js";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seal, unseal } from "../public/ibe.js";
import { identity } from "../api.js";

test("Authenticated directive lifecycle", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-"));
  let env = openStore(dir);
  t.after(() => {
    env.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const api = async (path: string, data?: unknown, token?: string) => {
    const res = await handle(
      new Request("http://localhost/api/" + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer " + (token || ""),
          "content-type": "application/json",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      env,
    );
    return { status: res.status, ...(await res.json()) };
  };
  const w = await api("workspaces", {});
  assert.equal(w.status, 201);
  const [hq, alice, bob] = await Promise.all(
    w.accounts.map(
      async (a: { email: string; pass: string }) =>
        (await api("login", { workspace: w.workspace, ...a })).token,
    ),
  );
  const aliceEmail = w.accounts[1].email;
  const initial = await api("state", undefined, alice);
  const id = identity(w.workspace, aliceEmail, 1);
  const original = "Evacuate Building A. شمالی گیٹ";
  const envelope = await seal(initial.user.public_key, id, original);
  await t.test("HQ sends before a private key has been issued", async () => {
    assert.equal(initial.user.issued_at, null);
    assert.equal(
      (
        await api(
          "directives",
          { recipient: aliceEmail, version: 1, envelope },
          hq,
        )
      ).status,
      201,
    );
    const state = await api("state", undefined, alice);
    assert.equal(state.user.issued_at, null);
    assert.equal(state.messages.length, 1);
    assert.deepEqual(state.messages[0].envelope, envelope);
  });
  const a = await api("keys", {}, alice),
    b = await api("keys", {}, bob);
  await t.test("Alice recovers the original UTF-8 instructions", async () =>
    assert.equal(await unseal(a.key, id, envelope), original),
  );
  await t.test(
    "Copied envelope rejects Bob’s valid key",
    async () => await assert.rejects(unseal(b.key, id, envelope)),
  );
  await t.test("Modified body fails authentication", async () => {
    const altered = {
      ...envelope,
      body:
        (envelope.body.startsWith("00") ? "ff" : "00") + envelope.body.slice(2),
    };
    await assert.rejects(unseal(a.key, id, altered));
  });
  await t.test(
    "Service enforces identity, role and session boundaries",
    async () => {
      assert.equal((await api("keys", { email: aliceEmail }, bob)).status, 403);
      assert.equal(
        (
          await api(
            "directives",
            { recipient: aliceEmail, version: 1, envelope },
            bob,
          )
        ).status,
        403,
      );
      assert.equal((await api("state")).status, 401);
      assert.equal((await api("state", undefined, bob)).messages.length, 0);
      const other = await api("workspaces", {});
      const visitor = (
        await api("login", { workspace: other.workspace, ...other.accounts[1] })
      ).token;
      assert.equal((await api("state", undefined, visitor)).messages.length, 0);
      await assert.rejects(
        unseal((await api("keys", {}, visitor)).key, id, envelope),
      );
    },
  );
  await t.test("Database holds ciphertext and survives restart", async () => {
    const db = new DatabaseSync(join(dir, "dispatch.sqlite"), {
      readOnly: true,
    });
    try {
      const row = db.prepare("SELECT envelope FROM directives").get();
      assert.equal(row?.envelope, JSON.stringify(envelope));
    } finally {
      db.close();
    }
    env.close();
    env = openStore(dir);
    const state = await api("state", undefined, alice);
    assert.equal(
      await unseal(
        (await api("keys", {}, alice)).key,
        id,
        state.messages[0].envelope,
      ),
      original,
    );
  });
  await t.test(
    "Rotation blocks stale sends and separates key versions",
    async () => {
      assert.equal(
        (await api("rotate", { recipient: aliceEmail, version: 1 }, hq))
          .version,
        2,
      );
      assert.equal(
        (
          await api(
            "directives",
            { recipient: aliceEmail, version: 1, envelope },
            hq,
          )
        ).status,
        409,
      );
      const id2 = identity(w.workspace, aliceEmail, 2);
      const newEnvelope = await seal(initial.user.public_key, id2, original);
      await assert.rejects(unseal(a.key, id2, newEnvelope));
      assert.equal(
        await unseal((await api("keys", {}, alice)).key, id2, newEnvelope),
        original,
      );
    },
  );
  await t.test("Custom badge receives a directive before first login and can be revoked", async () => {
    const badge = "field-17";
    assert.equal((await api("employees", { recipient: badge }, bob)).status, 403);
    const employee = await api("employees", { recipient: " FIELD-17 " }, hq);
    assert.equal(employee.status, 201);
    assert.equal((await api("employees", { recipient: badge }, hq)).status, 409);
    const target = { recipient: badge, version: 1 };
    const badgeId = identity(w.workspace, badge, 1);
    const sealed = await seal(initial.user.public_key, badgeId, original);
    const directive = { ...target, envelope: sealed };
    assert.equal((await api("directives", directive, hq)).status, 201);
    const login = { workspace: w.workspace, email: badge, pass: employee.pass };
    const session = (await api("login", login)).token;
    const inbox = await api("state", undefined, session);
    assert.equal(inbox.user.issued_at, null);
    const issued = await api("keys", {}, session);
    assert.equal(await unseal(issued.key, badgeId, inbox.messages[0].envelope), original);
    assert.equal((await api("revoke", target, bob)).status, 403);
    assert.equal((await api("revoke", target, hq)).status, 200);
    assert.equal((await api("revoke", target, hq)).status, 200);
    env.close();
    env = openStore(dir);
    assert.equal((await api("login", login)).status, 401);
    assert.equal((await api("keys", {}, session)).status, 401);
    assert.equal((await api("state", undefined, session)).status, 401);
    assert.equal((await api("rotate", target, hq)).status, 409);
    assert.equal((await api("directives", directive, hq)).status, 409);
    assert.equal((await api("employees", target, hq)).status, 409);
    assert.equal(await unseal(issued.key, badgeId, sealed), original);
  });
  await t.test("Sign-out invalidates the bearer token", async () => {
    await api("logout", {}, alice);
    assert.equal((await api("state", undefined, alice)).status, 401);
  });
});
