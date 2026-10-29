// Audit: find English-plain "stably" (not stablyai/stablygroup) in the PRISTINE commit,
// and check whether the codemod corrupted those sentences in the working tree.
import { execSync } from "node:child_process";

const list = execSync(`git grep -l -E "stably" HEAD -- "*.ts" "*.tsx" "*.md" "*.mdx" "*.mjs" "*.cjs" "*.rs" "*.swift" "*.py" "*.plugin.ts"`, {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .split("\n")
  .filter(Boolean)
  .map((f) => f.replace(/^HEAD:/, ""));

let hits = 0;
const bad = [];
for (const f of list) {
  let blob;
  try {
    blob = execSync(`git show "HEAD:${f}"`, { encoding: "utf8", maxBuffer: 1 << 26 });
  } catch { continue; }
  const edited = (() => { try { return require("fs").readFileSync(f, "utf8"); } catch { return ""; } })();
  const re = /[^\n]{0,60}\bstably\b[^\n]{0,50}/gi;
  for (const m of blob.matchAll(re)) {
    const ctx = m[0];
    if (/stablyai|stablygroup|@stablyai/i.test(ctx)) continue;
    hits++;
    // was this sentence mangled in the working tree? look for its middle words
    const probe = ctx.replace(/stably/ig, "X").replace(/[^\w X'-]/g, "").split(/\s+/).filter((w) => w.length > 3)[0];
    const survived = probe ? edited.includes(probe.replace(/X/g, "X")) : false;
    bad.push({ f, ctx: ctx.trim(), probe });
  }
}
console.log("english-plain stably sentences in PRISTINE:", hits);
console.log("sample of first 25:");
for (const b of bad.slice(0, 25)) console.log(`- ${b.f}\n    ${b.ctx}`);
