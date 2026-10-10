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
  calendarDate,
  rankingFrames,
  rankingAxis,
  formatMetric,
  formatAverage,
} from "../src/web/analytics.mjs";
test("ranking axes use round ticks with a ceiling that contains the leader", () => {
  assert.deepEqual(rankingAxis(33000000), {maximum: 40000000, ticks: [0, 10000000, 20000000, 30000000, 40000000]});
  assert.deepEqual(rankingAxis(27000000), {maximum: 30000000, ticks: [0, 10000000, 20000000, 30000000]});
  assert.equal(rankingAxis(40000000).maximum, 40000000);
  assert.equal(rankingAxis(40000001).maximum, 50000000);
  for (const value of [0, 1, 6, 12, 19.7, 51, 31000, 990000, 1250000000]) {
    const {maximum, ticks} = rankingAxis(value);
    assert.ok(maximum >= value);
    assert.equal(ticks[0], 0);
    assert.equal(ticks.at(-1), maximum);
    assert.ok(ticks.length <= 6);
    assert.ok(ticks.every(Number.isInteger));
    assert.ok(ticks.slice(1).every((tick, index) => tick - ticks[index] === ticks[1]));
  }
});
test("requests stay unabridged and abbreviated token values keep two decimal places", () => {
  assert.equal(formatMetric(11680, "requests"), "11,680");
  assert.equal(formatMetric(11680, "rounds"), "11,680");
  assert.equal(formatMetric(130500000, "total"), "130.50M");
  assert.equal(formatMetric(1000000, "input"), "1.00M");
  assert.equal(formatMetric(11680, "output"), "11.68K");
  assert.equal(formatMetric(0, "total"), "0");
});
test("request averages use at most one decimal while token averages keep their format", () => {
  assert.equal(formatAverage(49.03, "requests"), "49");
  assert.equal(formatAverage(49.06, "requests"), "49.1");
  assert.equal(formatAverage(1234.567, "requests"), "1,234.6");
  assert.equal(formatAverage(130500000, "total"), "130.50M");
});
test("today follows the report timezone across midnight", () => {
  const instant = new Date("2026-10-09T15:00:00Z");
  assert.equal(calendarDate("Asia/Seoul", instant), "2026-10-10");
  assert.equal(calendarDate("UTC", instant), "2026-10-09");
  assert.equal(calendarDate("America/New_York", instant), "2026-10-09");
});
test("ranking race changes rolling ranks and carries totals through empty days", () => {
  const rows = [
    {date: "2026-10-01", model: "a", requests: 10},
    {date: "2026-10-01", model: "b", requests: 2},
    {date: "2026-10-02", model: "b", requests: 20},
    {date: "2026-10-02", model: "a", requests: 1},
  ];
  const weekly = rankingFrames(rows, "2026-10-01", "2026-10-03", "requests");
  assert.deepEqual(weekly.map(frame => frame.ranking.map(row => row.model)), [["a", "b"], ["b", "a"], ["b", "a"]]);
  const cumulative = rankingFrames(rows, "2026-10-01", "2026-10-03", "requests", "cumulative");
  assert.deepEqual(cumulative[2].ranking, [{model: "b", value: 22}, {model: "a", value: 11}]);
});
test("rolling windows include earlier history and expire usage at exactly seven or thirty days", () => {
  const rows = [
    {date: "2026-09-30", model: "outside", requests: 100},
    {date: "2026-10-01", model: "a", requests: 10},
    {date: "2026-10-07", model: "b", requests: 12},
    {date: "2026-10-08", model: "a", requests: 1},
  ];
  const weekly = rankingFrames(rows, "2026-10-01", "2026-10-31", "requests", "week");
  assert.deepEqual(weekly[0].ranking, [{model: "outside", value: 100}, {model: "a", value: 10}]);
  assert.deepEqual(weekly[6].ranking, [{model: "b", value: 12}, {model: "a", value: 10}]);
  assert.deepEqual(weekly[7].ranking, [{model: "b", value: 12}, {model: "a", value: 1}]);
  assert.deepEqual(weekly[14].ranking, []);
  const monthly = rankingFrames(rows, "2026-10-01", "2026-10-31", "requests", "month");
  assert.deepEqual(monthly[29].ranking, [{model: "b", value: 12}, {model: "a", value: 11}]);
  assert.deepEqual(monthly[30].ranking, [{model: "b", value: 12}, {model: "a", value: 1}]);
  const cumulative = rankingFrames(rows, "2026-10-01", "2026-10-31", "requests", "cumulative");
  assert.deepEqual(cumulative[30].ranking, [{model: "b", value: 12}, {model: "a", value: 11}]);
});
test("rolling history precedes the replay range while cumulative starts at the selected date", () => {
  const rows = [
    {date: "2026-09-10", model: "a", total: 1000},
    {date: "2026-09-11", model: "a", total: 100},
    {date: "2026-10-03", model: "a", total: 20},
    {date: "2026-10-04", model: "a", total: 10},
    {date: "2026-10-10", model: "a", total: 1},
    {date: "2026-10-11", model: "a", total: 2},
  ];
  const weekly = rankingFrames(rows, "2026-10-10", "2026-10-11", "total", "week");
  assert.deepEqual(weekly.map(frame => frame.ranking[0].value), [11, 3]);
  const monthly = rankingFrames(rows, "2026-10-10", "2026-10-11", "total", "month");
  assert.deepEqual(monthly.map(frame => frame.ranking[0].value), [131, 33]);
  const cumulative = rankingFrames(rows, "2026-10-10", "2026-10-11", "total", "cumulative");
  assert.deepEqual(cumulative.map(frame => frame.ranking[0].value), [1, 3]);
  assert.deepEqual(monthly.map(frame => frame.date), ["2026-10-10", "2026-10-11"]);
});
test("ranking race combines harnesses and includes every model with positive usage", () => {
  const rows = Array.from({length: 16}, (_, index) => ({date: "2026-10-01", model: `model-${index}`, total: index}));
  rows.push({date: "2026-10-01", model: "model-1", total: 50});
  rows.push({date: "2026-10-01", model: "unknown", missing: 1});
  const [frame] = rankingFrames(rows, "2026-10-01", "2026-10-01", "total");
  assert.equal(frame.ranking.length, 15);
  assert.deepEqual(frame.ranking[0], {model: "model-1", value: 51});
  assert.deepEqual(frame.ranking.map(row => row.model), ["model-1", ...Array.from({length: 14}, (_, index) => `model-${15 - index}`)]);
  assert.ok(frame.ranking.every(row => row.value > 0));
});
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
