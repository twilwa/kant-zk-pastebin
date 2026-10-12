// ABOUTME: Bundles both browser applications and the downloadable Kant CLI.
// ABOUTME: Keeps dependencies local so conversation pages do not load third-party scripts.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
await mkdir("public", { recursive: true });
await build({
  entryPoints: ["web/app.js"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "public/app.js",
});
for (const name of ["index.html", "style.css", "skill.md", "favicon.svg"])
  await copyFile("web/" + name, "public/" + name);

await mkdir("public/pastebin", { recursive: true });
for (const name of ["app.js", "style.css"])
  await copyFile("../static-pastebin/" + name, "public/pastebin/" + name);
const editor = await readFile("../static-pastebin/index.html", "utf8");
const qrSource =
  "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
if (!editor.includes(qrSource)) throw new Error("Missing editor QR dependency");
await writeFile(
  "public/pastebin/index.html",
  editor.replace(qrSource, "qrcode.js"),
);
const require = createRequire(import.meta.url);
await copyFile(
  require.resolve("qrcode-generator"),
  "public/pastebin/qrcode.js",
);
execFileSync(process.execPath, ["scripts/build-cli.mjs"], {
  cwd: "..",
  env: {
    ...process.env,
    PATH: resolve("node_modules/.bin") + delimiter + process.env.PATH,
  },
  stdio: "inherit",
});
for (const name of ["kant-cli.mjs", "kant-cli.sha256", "kant-cli.version"])
  await copyFile("../dist/" + name, "public/pastebin/" + name);
