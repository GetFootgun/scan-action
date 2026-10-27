// Pure helpers for the Footgun scan action: input checks, the job summary, annotations, and the badge.

/** The CLI release this action runs. Pinned so a new CLI never changes a workflow without a new action release. */
export const CLI_VERSION = "0.2.2";

const FAIL_ON = ["breaks", "will-break", "none"];

export function parseFailOn(v) {
  const s = (v || "none").trim().toLowerCase();
  if (!FAIL_ON.includes(s)) throw new Error(`fail-on must be one of ${FAIL_ON.join(", ")}, got "${v}"`);
  return s;
}

/** Arguments for `npx`. --fail-on none means no --fail-on flag. */
export function cliArgs({ path, failOn }) {
  const args = ["--yes", `@getfootgun/footgun@${CLI_VERSION}`, "scan", path, "--json"];
  if (failOn !== "none") args.push("--fail-on", failOn);
  return args;
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

/** The same badge `footgun scan` prints: "no known API traps" only when nothing at all was found. */
export function badgeFor(findings, date, base = "https://getfootgun.com") {
  return findings.length === 0
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
