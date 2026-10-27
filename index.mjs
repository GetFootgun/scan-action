// Footgun scan action: runs the pinned Footgun CLI on the checked-out code, writes a job summary, and fails the job
// only when fail-on asks for it. The scan runs on the runner; no code is sent anywhere.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { annotations, badgeFor, cliArgs, counts, parseFailOn, summaryMarkdown } from "./summary.mjs";

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();

function main() {
  const path = input("path") || ".";
  const failOn = parseFailOn(input("fail-on"));
  const key = input("api-key");
  const env = { ...process.env };
  if (key) {
    console.log(`::add-mask::${key}`);
    env.FOOTGUN_API_KEY = key;
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(npx, cliArgs({ path, failOn }), { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  if (r.error) throw new Error(`could not run npx (is Node.js on the runner's PATH?): ${r.error.message}`);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0 && r.status !== 1) throw new Error(`footgun scan exited ${r.status}`);
  const report = JSON.parse(r.stdout);
  const findings = report.findings ?? [];
  const badge = report.badge ?? badgeFor(findings, new Date().toISOString().slice(0, 10));
  for (const line of annotations(findings, path)) console.log(line);
  const md = summaryMarkdown(report, { path, badge });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  else console.log(md);
  const c = counts(findings);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `problems=${c.problems}\nbreaks=${c.breaks}\nwill-break=${c.willBreak}\nbadge=${badge}\n`);
  }
  console.log(`Footgun: ${c.problems} ${c.problems === 1 ? "problem" : "problems"} (${c.breaks} break now, ${c.willBreak} will break), ${c.manual} to check yourself.`);
  if (r.status === 1) {
    console.log(`::error::Footgun found a problem at or above fail-on: ${failOn}. See the job summary.`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (e) {
  console.log(`::error::${String(e.message).replace(/\r?\n/g, " ")}`);
  process.exitCode = 1;
}
