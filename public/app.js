import { seal, unseal } from "./ibe.js";
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (text, fn, cls = "light") => {
  const node = el("button", text, cls);
  node.type = "button";
  node.onclick = action(fn);
  return node;
};
const note = (text) => {
  $("notice").textContent = text;
};
function action(fn) {
  return async (event) => {
    event?.preventDefault();
    const node = event?.submitter || event?.currentTarget;
    if (node?.disabled) return;
    if (node) node.disabled = true;
    try {
      note("");
      await fn(event);
    } catch (err) {
      note(err.message);
    } finally {
      if (node) node.disabled = false;
    }
  };
}
let token = sessionStorage.getItem("dispatch.session"),
  state,
  keys = new Map();
const address = (email, v) =>
  JSON.stringify(["dispatch-v1", state.user.workspace, email, v]);
const date = (s) =>
  new Date(s).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
async function api(path, data) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const out = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== "login") signedOut();
    throw Error(out.error || "Request failed.");
  }
  return out;
}
function signedOut() {
  token = null;
  state = null;
  keys.clear();
  $("issued-code").replaceChildren();
  $("provision").reset();
  sessionStorage.removeItem("dispatch.session");
  $("access").hidden = false;
  $("desk").hidden = true;
  $("logout").hidden = true;
  $("identity").textContent = "Secure communications";
  $("panel").replaceChildren();
  $("messages").replaceChildren();
  $("message").value = "";
}
function download(name, content) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const form = $("login");
const query = new URLSearchParams(location.search);
form.elements.workspace.value = query.get("workspace") || "";
form.elements.email.value = query.get("email") || "";
$("create").onclick = action(async () => {
  const packet = await api("workspaces", {});
  const box = $("credentials");
  box.replaceChildren(
    el("h3", "Workspace access"),
    el(
      "p",
      "Save the credentials now. Give each person only their own access code.",
    ),
    el("code", packet.workspace, "code"),
  );
  for (const a of packet.accounts) {
    const title = el("a", a.email);
    title.href =
      "/?" +
      new URLSearchParams({ workspace: packet.workspace, email: a.email });
    title.target = "_blank";
    title.rel = "noopener";
    box.append(title, el("code", a.pass, "code"));
  }
  box.append(
    button("Save access codes", () =>
      download("workspace-access.json", JSON.stringify(packet, null, 2)),
    ),
  );
  form.elements.workspace.value = packet.workspace;
  form.elements.email.value = packet.accounts[0].email;
  form.elements.pass.value = packet.accounts[0].pass;
  $("create").hidden = true;
  note("Workspace created. Save the access codes before signing in.");
});
form.onsubmit = action(async () => {
  const out = await api("login", Object.fromEntries(new FormData(form)));
  token = out.token;
  sessionStorage.setItem("dispatch.session", token);
  form.elements.pass.value = "";
  $("credentials").replaceChildren();
  $("create").hidden = false;
  await refresh();
});
$("logout").onclick = action(async () => {
  try {
    await api("logout", {});
  } finally {
    signedOut();
  }
});
$("refresh").onclick = action(() => refresh());
$("provision").onsubmit = action(async () => {
  const form = $("provision");
  const account = await api("employees", { recipient: form.elements.badge.value });
  form.reset();
  const box = $("issued-code");
  box.replaceChildren(
    el("p", "Give this access code privately to " + account.recipient + "."),
    el("code", account.pass, "code"),
    button("Hide access code", () => box.replaceChildren()),
  );
  await refresh();
  $("recipient").value = account.recipient;
  status();
});
function recipient() {
  return state.recipients.find((r) => r.email === $("recipient").value);
}
function status() {
  const r = recipient();
  $("key-status").textContent = r
    ? "Key version " +
      r.version +
      " · " +
      (r.issued_at ? "Issued " + date(r.issued_at) : "Awaiting first issuance")
    : "";
}
$("recipient").onchange = status;
$("send").onsubmit = action(async () => {
  const r = recipient();
  if (!r) throw Error("Add an active employee first.");
  const message = $("message").value;
  if (!message.trim()) throw Error("Enter the instructions.");
  const encrypted = await seal(
    state.user.public_key,
    address(r.email, r.version),
    message,
  );
  const out = await api("directives", {
    recipient: r.email,
    version: r.version,
    envelope: encrypted,
  });
  $("message").value = "";
  await refresh();
  note("Directive " + out.id.slice(0, 8) + " sent.");
});
async function refresh() {
  const old = $("recipient").value;
  state = await api("state");
  const hq = state.user.role === "hq";
  $("access").hidden = true;
  $("desk").hidden = false;
  $("logout").hidden = false;
  $("identity").textContent = state.user.email;
  $("role").textContent = hq ? "Headquarters" : "Employee communications";
  $("heading").textContent = hq ? "Directive register" : "My directives";
  $("detail").textContent = hq
    ? "Send an instruction to an employee identity, including employees awaiting their first key."
    : "Retrieve your identity key to open the instructions addressed to you.";
  $("compose").hidden = !hq;
  $("employee-access").hidden = !hq;
  $("register").textContent = hq ? "Sent directives" : "Inbox";
  $("panel-title").textContent = hq ? "Recipient keys" : "Identity key";
  $("recipient").replaceChildren(
    ...state.recipients.map((r) => new Option(r.email, r.email)),
  );
  if (state.recipients.some((r) => r.email === old)) $("recipient").value = old;
  status();
  renderMessages();
  renderPanel(hq);
}
function renderMessages() {
  const list = $("messages");
  list.replaceChildren();
  if (!state.messages.length)
    list.append(
      el(
        "p",
        state.user.role === "hq"
          ? "Issued directives will appear here."
          : "Your inbox is empty.",
      ),
    );
  for (const m of state.messages) {
    const row = el("section", undefined, "row");
    const tag = el("span", "Encrypted · v" + m.version, "tag");
    row.append(
      tag,
      el("h3", "Directive " + m.id.slice(0, 8)),
      el("time", date(m.created_at) + " · " + m.recipient),
    );
    const details = el("details");
    details.append(
      el("summary", "Inspect envelope"),
      el("pre", JSON.stringify(m.envelope, null, 2)),
    );
    const controls = el("div", undefined, "buttons"),
      result = el("div");
    if (state.user.role === "employee")
      controls.append(
        button("Decrypt directive", async () => {
          if (!keys.has(m.version))
            throw Error("Retrieve the matching identity key first.");
          const text = await unseal(
            keys.get(m.version),
            address(m.recipient, m.version),
            m.envelope,
          );
          result.replaceChildren(el("p", text, "plain"));
        }),
      );
    controls.append(
      button(
        "Export envelope",
        () =>
          download(
            m.id + ".json",
            JSON.stringify(
              {
                workspace: m.workspace,
                recipient: m.recipient,
                version: m.version,
                envelope: m.envelope,
              },
              null,
              2,
            ),
          ),
        "link",
      ),
    );
    row.append(controls, result, details);
    list.append(row);
  }
}
function renderPanel(hq) {
  const panel = $("panel");
  panel.replaceChildren();
  if (hq) {
    for (const r of state.recipients) {
      const row = el("div", undefined, "row");
      row.append(
        el("h3", r.email),
        el(
          "small",
          "Version " +
            r.version +
            " · " +
            (r.issued_at
              ? "Issued " + date(r.issued_at)
              : "Awaiting first issuance"),
        ),
        button("Revoke access", async () => {
          if (!confirm("Permanently disable " + r.email + "? Existing sessions will close. Previously obtained keys can still open old directives.")) return;
          await api("revoke", { recipient: r.email });
          $("issued-code").replaceChildren();
          await refresh();
          note("Employee access revoked.");
        }),
        button("Rotate key", async () => {
          if (
            !confirm(
              "Start a new key version for " +
                r.email +
                "? Previous versions cannot be retrieved again.",
            )
          )
            return;
          await api("rotate", { recipient: r.email, version: r.version });
          await refresh();
          note("New directives will use the new key version.");
        }),
      );
      panel.append(row);
    }
    return;
  }
  const u = state.user;
  panel.append(
    el("span", "Version " + u.version, "tag"),
    el("h3", u.email),
    el(
      "p",
      u.issued_at
        ? "First issued " + date(u.issued_at)
        : "No key has been issued for this identity version.",
    ),
    button(
      keys.has(u.version) ? "Retrieve key again" : "Retrieve my key",
      async () => {
        const k = await api("keys", {});
        keys.set(k.version, k.key);
        await refresh();
        note("Identity key available in this tab.");
      },
    ),
  );
  const check = el("details");
  const label = el("label", "Encrypted envelope (.json)");
  const file = el("input");
  file.type = "file";
  file.accept = ".json,application/json";
  label.append(file);
  const outcome = el("output");
  outcome.setAttribute("aria-live", "polite");
  check.append(
    el("summary", "Open an exported envelope"),
    el(
      "p",
      "Use your current identity key with an envelope from the register.",
    ),
    label,
    button("Open envelope", async () => {
      outcome.textContent = "";
      const selected = file.files[0];
      if (!selected || selected.size > 32000)
        throw Error("Choose an envelope under 32 KB.");
      if (!keys.has(u.version))
        throw Error("Retrieve your identity key first.");
      try {
        const m = JSON.parse(await selected.text());
        if (m.workspace !== u.workspace) throw Error();
        outcome.textContent = await unseal(
          keys.get(u.version),
          address(m.recipient, m.version),
          m.envelope,
        );
      } catch {
        outcome.textContent =
          "Decryption failed. The identity key or envelope does not match.";
      }
    }),
    outcome,
  );
  panel.append(check);
}
if (token) refresh().catch((e) => note(e.message));
