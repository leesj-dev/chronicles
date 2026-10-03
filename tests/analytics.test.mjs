import test from "node:test";
import assert from "node:assert/strict";
import {
  normalize,
  historyHarnesses,
  filterRows,
  aggregate,
  percentage,
  modelColor,
  modelId,
  periods,
  summarize,
} from "../src/web/analytics.mjs";
const fixture = {
  rows: [
    {
      date: "2026-01-01",
      provider: "codex",
      model: "gpt-5.4",
      requests: 2,
      total: 100,
      device: "shared",
    },
    {
      date: "2026-01-01",
      provider: "copilot",
      model: "copilot/gpt-5.4",
      requests: 1,
      total: 50,
      device: "this-mac",
      rounds: 3,
      roundRecords: 1,
    },
  ],
  missing: [
    {
      date: "2026-01-02",
      provider: "copilot",
      model: "copilot/claude-sonnet-4.5",
      device: "this-mac",
      rounds: 7,
    },
  ],
};
test("missing tokens contribute to request and round counts, never token totals", () => {
  const r = normalize(fixture);
  assert.equal(summarize(r, "requests", "2026-01-01", "2026-01-02").total, 4);
  assert.equal(summarize(r, "total", "2026-01-01", "2026-01-02").total, 150);
  assert.equal(summarize(r, "rounds", "2026-01-01", "2026-01-02").total, 10);
  assert.equal(summarize(r, "requests", "2026-01-01", "2026-01-02").average, 2);
});
test("same model merges across harnesses and colors stay stable", () => {
  const r = aggregate(normalize(fixture), "requests");
  assert.equal(r.find((r) => r.model === "gpt-5.4").value, 3);
  assert.equal(modelColor("copilot/gpt-5.4"), modelColor("gpt-5.4"));
  assert.notEqual(modelColor("gpt-5.6-sol"), modelColor("gpt-5.6-luna"));
  assert.notEqual(modelColor("gpt-5.6-sol"), modelColor("gpt-5.6-terra"));
  assert.equal(modelId("github.copilot-chat/gpt-5.4"), "gpt-5.4");
  assert.equal(modelId("claude-opus-4-6"), modelId("copilot/claude-opus-4.6"));
});
test("harness deselection and device filters change the actual aggregate", () => {
  const rows = normalize(fixture),
    options = {
      start: "2026-01-01",
      end: "2026-01-02",
      harnesses: new Set(["copilot"]),
      models: new Set(rows.map((r) => r.model)),
    };
  assert.equal(filterRows(rows, options).length, 2);
  assert.equal(
    filterRows(rows, { ...options, harnesses: new Set() }).length,
    0,
  );
  assert.equal(filterRows(rows, { ...options, device: "macmini" }).length, 0);
  assert.equal(
    filterRows(rows, {
      ...options,
      harnesses: new Set(["codex"]),
      device: "macmini",
    }).length,
    1,
  );
});
test("periods cover the range once, clip edges and use actual dates", () => {
  for (const mode of ["eras", "weeks", "months"]) {
    const p = periods(normalize(fixture), "2026-01-01", "2026-02-03", mode);
    assert.equal(p[0].start, "2026-01-01");
    assert.equal(p.at(-1).end, "2026-02-03");
    for (let i = 1; i < p.length; i++)
      assert.equal(Date.parse(p[i].start) - Date.parse(p[i - 1].end), 86400000);
  }
});
test("small shares are readable and never claim zero usage", () => {
  assert.equal(percentage(1, 10000), "<0.1%");
  assert.equal(percentage(1, 0), "—");
});

test("harness availability comes from history, including missing-token requests", () => {
  const rows = normalize({
    rows: [{provider: "codex", model: "gpt-5.4", date: "2026-01-01", requests: 1, total: 10}],
    missing: [{provider: "copilot", date: "2026-01-02", model: "sonnet"}],
    accountSnapshots: [{provider: "cursor", lines: [{type: "progress", used: 20}]}],
  });
  assert.deepEqual(historyHarnesses(rows).map(([key]) => key), ["codex", "copilot"]);
  assert.deepEqual(historyHarnesses([]), []);
  assert.deepEqual(historyHarnesses([{provider: "cursor", requests: 0, total: 0}]), []);
});
