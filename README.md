# Chronicles

**Your AI usage story across models, harnesses, and time.**

Chronicles is a local-first, open-source usage explorer for Codex, Claude Code, GitHub Copilot, and Antigravity. Compare daily model usage or see how your model mix evolves across chapters. No cloud account, API key, build step, or third-party runtime package is required.

## Start

Requires Python 3.10+ and a modern browser. Node.js 20+ is optional for development checks. VS Code Copilot and Antigravity discovery currently targets macOS; Codex and Claude use their standard home directories on other systems.

```sh
git clone https://github.com/leesj-dev/chronicles.git
cd chronicles
python3 server.py
```

Open **http://127.0.0.1:8768/**. The first scan can take a while for large histories; subsequent scans cache unchanged files in memory.

For fictional sample data:

```sh
python3 server.py --demo
```

You can also switch between demo and local data in the app. Demo screenshots and `examples/demo.json` contain fictional records only.

![Model chapters with fictional data](docs/chapters.png)

## Explore

- **Daily timeline:** stacked daily bars with date/model tooltips, stable colors, and model multi-selection.
- **Model chapters:** ranked, directly labeled circles; area shows each model's total, with a shared scale across chapters. Common-scale bars compare daily averages. Harness shares appear directly below each chapter total.
- **Harness badges:** toggle one harness, or use Select all / Deselect all.
- **Metrics:** requests/calls, total/input/output tokens, cache read/write, and Copilot response rounds. Both views use the same filters and colors.
- **Date range:** independent start/end sliders, date inputs, and range presets.
- **Chapters:** model-transition boundaries, 7-day intervals, or calendar months.
- **Export:** CSV respects the current selection and preserves missing token values as blank cells.
- **Theme:** automatically follows your system light/dark setting.

Transition chapters use the first day of a newly appearing model with at least 3 records and 0.5% of selected requests. Boundaries stay at least 7 days apart. Filtering recalculates chapters. Daily averages include inactive days in each chapter.

## Timezone

Dates default to UTC. Set an IANA timezone before launching or syncing:

```sh
CHRONICLES_TIMEZONE=Asia/Seoul python3 server.py
```

`CODEX_HOME` and `CLAUDE_CONFIG_DIR` override their respective log roots.

## Another device over SSH

Configure an SSH host with working batch authentication and Python 3.10+ on the remote device, then run:

```sh
python3 sync.py --host YOUR_SSH_HOST
```

The scanner executes over SSH without installing files remotely. Only normalized usage metadata is copied into ignored `.local/imports/macmini.json`; conversation text and credentials are not copied. One remote snapshot is supported; syncing another host replaces it. Local and imported duplicate records are merged. Use the same `CHRONICLES_TIMEZONE` for the server and sync.

## Standalone HTML

Export an interactive snapshot with the current record set:

```sh
python3 server.py --export exports/chronicles.html
python3 server.py --demo --export exports/demo.html
```

Open it directly in a browser. Both charts, filters, and sliders work offline. The export includes normalized usage metadata, not conversation content. Unlike CSV, its filters initially include the complete exported date range. Keep personal snapshots private if you do not intend to share your usage history.

## What counts as a record?

| Harness     | Source                                          | One requests/calls unit          |
| ----------- | ----------------------------------------------- | -------------------------------- |
| Codex       | `~/.codex/sessions` and `archived_sessions`     | Unique token-usage report        |
| Claude Code | `~/.claude/projects`                            | Response message carrying usage  |
| Copilot     | macOS VS Code `workspaceStorage/*/chatSessions` | Saved user request with a result |
| Antigravity | `~/.gemini/antigravity*/conversations/*.db`     | Generation metadata record       |

Requests/calls deliberately treats these units alike for approximate usage-pattern comparisons. Copilot response rounds count saved `toolCallRounds`; this is a separate Copilot-only metric. These units do not establish equivalent work, compute, or billing.

Older Copilot requests often retain model/date information without numeric token values: they count toward requests and available response rounds, never invented token totals. Legacy encrypted Antigravity `.pb` conversations are reported as excluded. Deleted or unpreserved records cannot be included. Incomplete token coverage is visible in the app.

Codex cached input is separated from input and reasoning is not added twice to output. Claude cache read/write are separate counters. Copilot does not preserve cache breakdown; those columns remain zero for measured records. Antigravity generation metadata contains input, output, and cached-read counters.

## Privacy

The server binds only to loopback, validates Host, serves an explicit asset allowlist, and uses a same-origin content policy. No analytics, external fonts, remote scripts, or automatic uploads. The API returns normalized usage metadata. Private imports, exports, and Python caches are gitignored. The repository contains synthetic sample data only.

## Development

No installation step is needed.

```sh
npm run check
npm test
npm run test:collectors
```

See [DESIGN.md](DESIGN.md) for the design direction and shared model color rules, and [CONTRIBUTING.md](CONTRIBUTING.md) for contributions.

## License

[MIT](LICENSE). Independent project; not affiliated with OpenAI, Anthropic, GitHub, Google, or Linear. Design direction references [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md). Antigravity counter parsing follows the observed generation metadata format described by [OpenUsage](https://github.com/robinebers/openusage/blob/main/docs/providers/antigravity.md).
