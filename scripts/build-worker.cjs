const fs = require("node:fs"),
  path = require("node:path");
const ts = require(process.env.TYPESCRIPT_PATH || "typescript");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const modules = new Map();
function collect(name) {
  if (modules.has(name)) return;
  const code = ts.transpileModule(read(name), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  modules.set(
    name,
    code.replace(/require\("([^"]+)"\)/g, (_, id) => {
      if (!id.startsWith(".")) throw Error("Unexpected module " + id);
      const dep = path.posix.normalize(
        path.posix.join(path.posix.dirname(name), id),
      );
      collect(dep);
      return "load(" + JSON.stringify(dep) + ")";
    }),
  );
}
collect("api.js");
const assets = {};
for (const file of fs.readdirSync(path.join(root, "public"), {
  recursive: true,
})) {
  const key = file.split(path.sep).join("/");
  if (!/\.(js|html|css)$/.test(key)) continue;
  assets["/" + key] = read("public/" + key);
}
const bundle =
  "const modules={" +
  [...modules]
    .map(([id, code]) => JSON.stringify(id) + ":(exports,load)=>{" + code + "}")
    .join(",") +
  "};\n" +
  "const cache={};function load(id){if(!cache[id]){cache[id]={};modules[id](cache[id],load)}return cache[id]}\n" +
  "const assets=" +
  JSON.stringify(assets) +
  ";\n" +
  read("scripts/worker-entry.txt");
const out = path.join(root, "dist");
fs.mkdirSync(path.join(out, "server"), { recursive: true });
fs.mkdirSync(path.join(out, ".openai"), { recursive: true });
fs.writeFileSync(path.join(out, "server/index.js"), bundle);
if (fs.existsSync(path.join(root, ".openai/hosting.json"))) fs.copyFileSync(
  path.join(root, ".openai/hosting.json"),
  path.join(out, ".openai/hosting.json"),
);

