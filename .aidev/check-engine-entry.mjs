// The /engine subpath is for servers: neither it nor a chunk it imports may import React or the UI
// libraries, and it must import in plain Node.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const entry = resolve("dist/engine.es.js");
const ui = /^(react|react-dom|@radix-ui\/|lucide-react|class-variance-authority|clsx|tailwind-merge)(\/|$)/;
const specifiers = /\b(?:import|export)\b[^"';]*?["']([^"']+)["']/g;

const seen = new Set();
const offending = [];
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  for (const [, specifier] of readFileSync(file, "utf8").matchAll(specifiers)) {
    if (specifier.startsWith(".")) walk(resolve(dirname(file), specifier));
    else if (ui.test(specifier)) offending.push(`${file}: ${specifier}`);
  }
};
walk(entry);
if (offending.length) {
  console.error("the engine entry imports UI code:\n" + offending.join("\n"));
  process.exit(1);
}

const engine = await import(pathToFileURL(entry).href);
for (const name of ["ApiSetEngine", "jsonRpcApiProbe", "memoryStorage"])
  if (typeof engine[name] !== "function") {
    console.error(`the engine entry does not export ${name}`);
    process.exit(1);
  }
if ("ApiSetsComponent" in engine) {
  console.error("the engine entry exports the React components");
  process.exit(1);
}
console.log(`engine entry: ${seen.size} file(s), no UI imports, imports in Node`);
