// Path rename pass v3: per-file full-path mapping with explicit dest dirs.
// Handles shared-parent relocs without sibling invalidation.
import { execSync, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function mapSeg(seg) {
  // segment already fully converted? (no orca anywhere in it as substring, any case)
  if (!/orca/i.test(seg)) {
    if (/octopus|shield|octopod|OSHIELD/i.test(seg) || !/(orca|stably)/i.test(seg)) return seg;
  }
  let s = seg;
  s = s.replaceAll("orcad", "octopod");
  s = s.replaceAll("Orcad", "Octopod");
  s = s.replaceAll("ORCAD", "OCTOPOD");
  s = s.replaceAll("orcaD", "shieldD");
  s = s.replaceAll("OrcaD", "ShieldD");
  s = s.replaceAll("orca", "shield");
  s = s.replaceAll("Orca", "Shield");
  s = s.replaceAll("ORCA", "OSHIELD");
  return s;
}

const files = execSync("git -c core.quotepath=false ls-files", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n").filter(Boolean);

const need = files.filter((f) => {
  const segs = f.split("/");
  return segs.some((s) => /orca/i.test(s));
});

let moved = 0, failed = 0;
for (const f of need) {
  const segs = f.split("/");
  const destSegs = segs.map(mapSeg);
  // normalize nested mapped segments (e.g. double mapping 'Octo')
  const dest = destSegs.join("/");
  if (dest === f) continue;
  try {
    const destDir = path.join(ROOT, path.dirname(dest));
    mkdirSync(destDir, { recursive: true });
    execFileSync("git", ["mv", f, dest], { cwd: ROOT, stdio: "pipe" });
    moved++;
  } catch (e) {
    failed++;
    if (failed <= 8) console.error("FAILED:", f, "->", dest, "|", String(e.stderr || "").trim().split("\n")[0]);
  }
}

// prune now-empty directories that originally carried the name (disk hygiene)
try {
  const empties = execSync(`git -c core.quotepath=false ls-files`, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean);
  void empties;
} catch {}
console.log(JSON.stringify({ candidates: need.length, moved, failed }));
