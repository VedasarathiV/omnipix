# OmniPix community skills pack

14 ready-to-install skills, adapted from the
[500 AI Agents Projects](https://github.com/ashishpatel26/500-ai-agents-projects)
collection (prompts rewritten for OmniPix tools; see each source below).

| Skill | From | Needs |
|---|---|---|
| code-review-checklist | 02-code-review-agent | read_file, git_diff |
| test-generator | 15-unit-test-generator | read_file, write_file, run_check |
| meeting-notes | 10-meeting-notes-agent | read_file, write_file |
| issue-triager | 07-github-issue-triager | fetch_url |
| web-researcher | 01-web-research-agent | web_search, fetch_url |
| competitor-analysis | 19-competitive-analysis-agent | web_search, fetch_url |
| email-drafter | 05-email-drafting-agent | — |
| social-writer | 14-social-media-agent | — |
| recipe-suggester | 17-recipe-agent | — |
| job-app | 18-job-application-agent | — |
| news-brief | 06-news-summarizer-agent | web_search, fetch_url |
| resume-parser | 09-resume-parser-agent | read_file |
| travel-planner | 12-travel-planner-agent | web_search, fetch_url (optional) |
| doc-writer | 16-documentation-writer | read_file, write_file |

## Install

Pick one (the server auto-discovers watched directories on boot and
refreshes on change — no import step):

```bash
# per-user (recommended)
mkdir -p ~/.config/omnipix/skills
cp -R skills/* ~/.config/omnipix/skills/

# one project only
mkdir -p .omnipix/skills
cp -R skills/* .omnipix/skills/

# explicit extra dir
export OMNIPIX_SKILLS_DIR=/path/to/skills
```

Or push them into a running gateway from the terminal:

```bash
omnipix skills import-dir ./skills --url http://localhost:3001 --token <dashboard-token>
```

`code-review-checklist` is named to avoid the builtin `code-reviewer`
(file skills never override builtins).
