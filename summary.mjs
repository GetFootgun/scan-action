// Pure helpers for the Footgun scan action: input checks, the job summary, annotations, and the badge.

/** The CLI release this action runs. Pinned so a new CLI never changes a workflow without a new action release. */
export const CLI_VERSION = "0.3.0";

const FAIL_ON = ["breaks", "will-break", "none"];

export function parseFailOn(v) {
  const s = (v || "none").trim().toLowerCase();
  if (!FAIL_ON.includes(s)) throw new Error(`fail-on must be one of ${FAIL_ON.join(", ")}, got "${v}"`);
  return s;
}

/** Arguments for `npx`. --fail-on none means no --fail-on flag. */
export function cliArgs({ path, failOn, watchArgs = /** @type {string[]} */ ([]) }) {
  const args = ["--yes", `@getfootgun/footgun@${CLI_VERSION}`, "scan", path, "--json"];
  if (failOn !== "none") args.push("--fail-on", failOn);
  return [...args, ...watchArgs];
}

/**
 * Extra CLI arguments for Watch. Only watch: "true" with a non-empty api-key sends anything; without a key it
 * returns a core warning command and no arguments. The project defaults to the repository's owner/name.
 */
export function watchPlan({ watch, apiKey, project, env }) {
  if ((watch || "").trim().toLowerCase() !== "true") return { args: [], warning: null };
  if (!apiKey) return { args: [], warning: "::warning::Footgun watch needs an api-key (a Pro or Team key, passed from a secret). Nothing was sent." };
  const repo = env.GITHUB_REPOSITORY ?? "";
  const args = ["--watch", "--project", project || repo];
  if (repo && env.GITHUB_SERVER_URL) args.push("--repo-url", `${env.GITHUB_SERVER_URL.replace(/\/+$/, "")}/${repo}`);
  return { args, warning: null };
}

const GROUPS = [
  ["breaks", "Breaks now"],
  ["will-break", "Will break"],
  ["silent", "Wrong results with no error"],
  ["cost", "Costs money"],
];

// Text from the rule pack goes into Markdown table cells: no pipes, no HTML, one line.
const cell = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();

export function counts(findings) {
  const found = findings.filter((f) => !f.manual);
  const by = (sev) => found.filter((f) => f.severity === sev).length;
  return { problems: found.length, breaks: by("breaks"), willBreak: by("will-break"), manual: findings.length - found.length };
}

/** The same badge `footgun scan` prints: "no known API traps" only when nothing was found apart from launch reminders. */
export function badgeFor(findings, date, base = "https://getfootgun.com") {
  return findings.every((f) => f.manual && f.launch)
    ? `[![No known API traps on ${date} · Footgun](${base}/badge.svg?s=clean&d=${date})](${base}/scan)`
    : `[![Scanned by Footgun on ${date}](${base}/badge.svg?s=scanned&d=${date})](${base}/scan)`;
}

const where = (path, f) => {
  const file = path === "." ? f.file : `${path.replace(/\/+$/, "")}/${f.file}`;
  return f.line ? `${file}:${f.line}` : file;
};

export function summaryMarkdown(report, { path, badge }) {
  const findings = report.findings ?? [];
  const c = counts(findings);
  const out = ["## Footgun scan", ""];
  if (!findings.length) {
    out.push(`No known API traps found in \`${cell(path)}\`.`, "");
  } else {
    out.push(`**${c.problems} ${c.problems === 1 ? "problem" : "problems"}** in \`${cell(path)}\`: ${c.breaks} break now, ${c.willBreak} will break.`, "");
    const found = findings.filter((f) => !f.manual);
    for (const [sev, heading] of GROUPS) {
      const group = found.filter((f) => f.severity === sev);
      if (!group.length) continue;
      out.push(`### ${heading}`, "", "| Trap | Service | Where | Deadline | Fix |", "| --- | --- | --- | --- | --- |");
      for (const f of group) {
        const title = f.url ? `[${cell(f.title)}](${f.url})` : cell(f.title);
        out.push(`| ${title} | ${cell(f.provider)} | \`${cell(where(path, f))}\` | ${cell(f.deadline) || " "} | ${cell(f.fix)} |`);
      }
      out.push("");
    }
    const manual = findings.filter((f) => f.manual);
    if (manual.length) {
      out.push("### Check these yourself", "", "The scanner found the package but cannot confirm the problem from code alone.", "");
      for (const f of manual) out.push(`- ${f.url ? `[${cell(f.title)}](${f.url})` : cell(f.title)}: ${cell(f.fix)}`);
      out.push("");
    }
  }
  if (report.skippedRules?.length) out.push(`${report.skippedRules.length} rules were skipped.`, "");
  if (report.fromCache) out.push("Rules came from the local cache because the download failed.", "");
  out.push("<details><summary>README badge for this scan</summary>", "", "```markdown", badge, "```", "", "</details>", "");
  out.push("Your code was scanned on this runner and never sent anywhere. [What Footgun is](https://getfootgun.com)", "");
  return out.join("\n");
}

// Workflow command escaping (data and property values), as in @actions/core.
const esc = (s) => String(s ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** One ::warning per confirmed finding, pinned to its file and line, so it shows on the pull request diff. */
export function annotations(findings, path) {
  return findings.filter((f) => !f.manual && f.file).map((f) => {
    const file = path === "." ? f.file : `${path.replace(/\/+$/, "")}/${f.file}`;
    return `::warning file=${escProp(file)}${f.line ? `,line=${f.line}` : ""},title=${escProp(`Footgun: ${f.title}`)}::${esc(`${f.fix}${f.url ? ` ${f.url}` : ""}`)}`;
  });
}

const SAFE_PROJECT = /^[A-Za-z0-9._/@ -]{1,200}$/;

/**
 * How to run `npx` without a shell where possible. npm ships npx-cli.js (next to node on Windows, under ../lib on
 * other systems); running it with node needs no shell, so no argument is ever re-parsed. If it is not found, other
 * systems run npx directly, and Windows (where npx.cmd needs a shell) gets a quoted command line after the project
 * name passes a strict check.
 */
export function npxInvocation({ platform, execPath, args, exists, join }) {
  const dir = execPath.slice(0, Math.max(execPath.lastIndexOf("/"), execPath.lastIndexOf("\\")));
  const candidates = platform === "win32"
    ? [join(dir, "node_modules", "npm", "bin", "npx-cli.js")]
    : [join(dir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js")];
  const cli = candidates.find((c) => exists(c));
  if (cli) return { command: execPath, args: [cli, ...args], shell: false };
  if (platform !== "win32") return { command: "npx", args, shell: false };
  const at = args.indexOf("--project");
  if (at !== -1 && !SAFE_PROJECT.test(args[at + 1] ?? "")) throw new Error("project may only use letters, digits, spaces and . _ / @ -");
  const quote = (a) => (/^[A-Za-z0-9._/:@=-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
  return { command: "npx.cmd", args: args.map(quote), shell: true };
}
