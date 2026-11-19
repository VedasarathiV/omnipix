# OmniPix PR Review action

Runs an OmniPix review agent over the pull request diff and posts the
verdict as a PR comment. The agent is read-only (read, grep, git log/diff)
and runs on **your** gateway, so no code leaves your infrastructure and any
provider key you configured can do the review.

## Use

```yaml
# .github/workflows/pr-review.yml
name: OmniPix review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: YOUR-ORG/omnipix/.github/actions/pr-review@main
        with:
          gateway-url: ${{ secrets.OMNIPIX_URL }}
          dashboard-token: ${{ secrets.OMNIPIX_DASHBOARD_TOKEN }}
          instructions: 'Focus on SQL injection and auth changes'
```

Point `uses:` at wherever you keep this repo (a fork works). The gateway
must be reachable from GitHub's runners — a VPS or tailnet-exposed server,
not `localhost`.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `gateway-url` | — | OmniPix server base URL |
| `dashboard-token` | — | Dashboard token (`Secrets` in CI, never inline) |
| `model` | `auto` | Review model id |
| `instructions` | `''` | Extra review focus |
| `max-steps` | `12` | Review run step budget |
| `timeout-minutes` | `15` | Poll timeout |

## How it works

1. Starts a review run at `POST /api/agents/review` with the PR's repo,
   base, and head. The server clones head, diffs against base, and
   launches a read-only agent with the code-reviewer skill.
2. Polls the run until it lands (terminal or failed).
3. Posts `final_answer` (first line: `Verdict: APPROVE/COMMENT/
   REQUEST_CHANGES`) as a PR comment.

A failed review run fails the workflow step but never blocks the merge —
wire the job as required only once you trust the verdicts.
