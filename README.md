# Footgun Scan

Checks your code for known API breaking changes and traps on every push or pull request, and lists what it finds in the job summary, with the fix and a link for each. It runs the [Footgun](https://getfootgun.com) scanner on the runner. Your code is never sent anywhere.

Footgun is a registry of dated, verified traps in third-party APIs, platforms and AI coding tools. The scanner checks your dependencies and code against the traps that have detection rules, for example GitHub Actions still built for Node 20, which GitHub now runs on Node 24.

## Usage

```yaml
name: footgun
on: [push, pull_request]
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: GetFootgun/scan-action@v1
        with:
          fail-on: breaks
```

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `path` | `.` | Folder to scan, relative to the repository root. |
| `fail-on` | `none` | `breaks` fails the job when something breaks now. `will-break` also fails on anything with a known break date or version. `none` only reports. Check-yourself items never fail the job. |
| `api-key` | | A Footgun API key, to also scan with your private traps. Pass it from a secret: `api-key: ${{ secrets.FOOTGUN_API_KEY }}`. |

## Outputs

`problems`, `breaks`, `will-break` (counts, not counting check-yourself items) and `badge` (Markdown for a README badge dated the day of the scan).

## What it does

1. Runs `npx @getfootgun/footgun scan` at a pinned version, so a new scanner release never changes your workflow without a new action release.
2. Writes the findings to the job summary, grouped into breaks now, will break, wrong results with no error, and costs money, then a list of items to check yourself.
3. Adds a warning on the file and line of each finding, so it shows on the pull request.

The runner needs Node.js on its PATH. GitHub-hosted runners have it; on a self-hosted runner, add `actions/setup-node` first.

The scanner sends one anonymous usage count per scan (that it ran, and how many traps matched at each severity, never paths, package names or code). Set `FOOTGUN_SHARE: "false"` in the job's `env` to turn it off.

## Badge

The job summary has a README badge for the scan. It reads "no known API traps" only when the scan found nothing at all, and "scanned" otherwise, with the date. It links to [the Footgun scan of AI-built apps](https://getfootgun.com/scan).

## License

MIT
