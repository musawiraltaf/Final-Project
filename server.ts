import { createServer, type IncomingMessage } from "node:http";
import { openStore } from "./database.ts";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "./api.js";

const base = fileURLToPath(new URL(".", import.meta.url));
const env = openStore(resolve(process.env.DATA_DIR || join(base, "data")));
const root = join(base, "public");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ico": "image/x-icon",
};
async function route(input: IncomingMessage) {
  const url = new URL(input.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of input) {
      length += chunk.length;
      if (length > 21000)
        return new Response("Request too large", { status: 413 });
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(input.headers))
      if (typeof value === "string") headers.set(key, value);
    return handle(
      new Request(url, {
        method: input.method,
        headers,
        body: chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined,
      }),
      { ...env, PEER: input.socket.remoteAddress || "local" },
    );
  }
  const file = resolve(
    root,
    "." +
      (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)),
  );
  if (
    !file.startsWith(root + sep) ||
    !types[extname(file)] ||
    !existsSync(file)
  )
    return new Response("Page unavailable", { status: 404 });
  return new Response(readFileSync(file), {
    headers: { "Content-Type": types[extname(file)] },
  });
}
const port = Number(process.env.PORT || 3080);
createServer(async (req, res) => {
  try {
    const out = await route(req);
    res.writeHead(out.status, {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ...Object.fromEntries(out.headers),
    });
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch {
    res.writeHead(400);
    res.end("Invalid request.");
  }
}).listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log("Dispatch listening on port " + port),
);
