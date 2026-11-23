import { createHash } from "node:crypto";
import esbuild from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
const client = await esbuild.build({
  entryPoints: ["ui/client.mjs"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  write: false,
});
const css = await Promise.all(
  ["ui/studio.css", "ui/clarity.css"].map((s) => readFile(s, "utf8")),
);
const html = await readFile("ui/index.html", "utf8");
const files = {
  "/": ["text/html; charset=utf-8", html],
  "/studio.css": ["text/css; charset=utf-8", css.join("\n")],
  "/studio.js": ["text/javascript; charset=utf-8", client.outputFiles[0].text],
};
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile(
  "src/web-assets.mjs",
  "const files=" +
    JSON.stringify(files) +
    ';\nexport function asset(path){const f=files[path];return f?new Response(f[1],{headers:{"Content-Type":f[0]}}):new Response("Not found",{status:404});}\n',
);
// Fingerprint every bundled input that can affect file extraction or scoring.
const graph = await esbuild.build({
  entryPoints:["src/analysis.mjs"], bundle:true, metafile:true, write:false, format:"esm",
  target:"es2022", platform:"browser", external:["node:*"], logLevel:"silent",
  define:{"process.versions.node":"undefined"},
});
const fingerprint = createHash("sha256");
for (const path of Object.keys(graph.metafile.inputs).sort()) {
  fingerprint.update(path + "\0").update(await readFile(path)).update("\0");
}
await esbuild.build({
  entryPoints: ["src/worker.mjs"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  external: ["node:*"],
  outfile: "dist/server/index.js",
  legalComments: "none",
  logLevel: "warning",
  define: { "process.versions.node": "undefined", __ENGINE_REVISION__: JSON.stringify(fingerprint.digest("hex")) },
});
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
