#!/usr/bin/env node
// Rebrand codemod v2: stablyai/orca -> Octopus Shield corporate namespace.
// Pooled async I/O + latin1 byte prefilter (fast skip of files with no brand tokens).
// Deterministic & idempotent when run on pristine or already-converted trees.
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MASK = "\u0000PWTEST_KEEP\u0000";
const CONC = 24;

const TEXT_EXT = new Set([
  ".js",".cjs",".mjs",".ts",".tsx",".json",".jsonc",".json5",".yaml",".yml",
  ".md",".mdx",".txt",".html",".htm",".css",".scss",".sh",".bash",".zsh",".fish",
  ".ps1",".rb",".py",".rs",".toml",".swift",".m",".mm",".h",".hh",".hpp",".c",
  ".cc",".cpp",".gyp",".gypi",".xml",".plist",".ent",".prefs",".cfg",".ini",
  ".env",".nix",".gradle",".kts",".webmanifest",".svg",".sql",".prisma",".proto",
  ".graphql",".gitignore",".gitattributes",".browserslistrc",".editorconfig",
  ".prettierrc",".oxlintrc",".oxfmtrc",".npmrc",".npmignore",".dockerignore",
  ".cargo",".desktop",".service",".conf",".list",".sls",".hbs",
]);
const TEXT_EXTLESS = new Set([
  "LICENSE","Dockerfile","Makefile","Rakefile","Gemfile","Procfile",
]);

const SKIP = (p) =>
  p === "pnpm-lock.yaml" ||
  p.startsWith(".git/") ||
  p.startsWith("config/rebrand/") ||
  p.includes("node_modules") ||
  /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|zip|gz|node|lib|pdb|exe|eot|mp[34]|wav|pdf|onnx|wasm|bin|tlog)$/i.test(p);

// triggers that justify the full UTF-8 pass (latin1 lowercased scan)
const TRIGGERS = ["orca", "stably", "onorca", "fzjdk", "app.orca", "octopod"];

function applyRules(s) {
  s = s.replaceAll("@stablyai/playwright-test", MASK);

  s = s.replaceAll("stablyai/orca-adhoc", "octopusshield/octopus-shield-adhoc");
  s = s.replaceAll("stablyai/orca-daily", "octopusshield/octopus-shield-daily");
  s = s.replaceAll("stablyai/orca", "octopusshield/octopus-shield");

  s = s.replaceAll("app.octopusshield.desktop", "app.octopusshield.desktop");
  s = s.replaceAll("app.octopusshield.mobile", "app.octopusshield.mobile");

  s = s.replaceAll("stablygroup", "octopusshield");
  s = s.replaceAll("stablyai", "octopusshield");
  s = s.replaceAll("StablyAI", "OctopusShield");
  s = s.replaceAll("Stably AI", "Octopus Shield");
  s = s.replaceAll("STABLY", "OCTOPUSSHIELD");
  s = s.replaceAll("Stably", "OctopusShield");

  s = s.replace(/([A-Za-z0-9-]+)\.onorca\.dev/g, "$1.octopusshield.invalid");
  s = s.replace(/(?:www\.)?onorca\.dev/g, "octopusshield.invalid");
  s = s.replaceAll("app.orca.dev", "app.octopusshield.invalid");

  s = s.replaceAll("discord.gg/fzjDKHxv8Q", "octopusshield.invalid/community");
  s = s.replaceAll("x.com/orca_build", "x.com/octopusshield_invalid");
  s = s.replaceAll("@orca_build", "@octopusshield_invalid");
  s = s.replaceAll(
    "apps.apple.com/us/app/orca-ide/id6766130217",
    "apps.apple.invalid/octopusshield",
  );

  // app-scope fusion identifiers FIRST (so orcad rules can't eat them)
  s = s.replaceAll("orcaD", "shieldD");
  s = s.replaceAll("OrcaD", "ShieldD");

  // daemon family (exact case branches only) — BEFORE generic orca
  s = s.replaceAll("orcad", "octopod");
  s = s.replaceAll("Orcad", "Octopod");
  s = s.replaceAll("ORCAD", "OCTOPOD");

  s = s.replaceAll("ORCA_", "OSHIELD_");
  s = s.replaceAll("orca://", "shield://");

  s = s.replaceAll("orca", "shield");
  s = s.replaceAll("Orca", "Shield");
  s = s.replaceAll("ORCA", "SHIELD");

  s = s.replaceAll(MASK, "@stablyai/playwright-test");
  return s;
}

const files = execSync("git -c core.quotepath=false ls-files", {
  cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28,
}).split("\n").filter(Boolean);

const targets = files.filter((rel) => !SKIP(rel) && (
  (path.extname(rel) && TEXT_EXT.has(path.extname(rel).toLowerCase())) ||
  TEXT_EXTLESS.has(path.basename(rel)) || !path.extname(rel)
));

let changed = 0, scanned = 0, cheapSkipped = 0, idx = 0;

async function worker() {
  while (idx < targets.length) {
    const rel = targets[idx++];
    const abs = path.join(ROOT, rel);
    let raw;
    try { raw = await readFile(abs); } catch { continue; }
    const probe = raw.toString("latin1").toLowerCase();
    if (!TRIGGERS.some((t) => probe.includes(t))) { cheapSkipped++; continue; }
    const s = raw.toString("utf8");
    const out = applyRules(s);
    scanned++;
    if (out !== s) {
      await writeFile(abs, out, "utf8");
      changed++;
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
process.stdout.write(JSON.stringify({ total: targets.length, scanned, changed, cheapSkipped }) + "\n");
