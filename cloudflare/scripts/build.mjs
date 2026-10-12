// ABOUTME: Bundles the browser app and copies its same-origin public assets.
// ABOUTME: Keeps dependencies local so conversation pages do not load third-party scripts.
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
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
