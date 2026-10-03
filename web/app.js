import {
  HARNESSES,
  historyHarnesses,
  METRICS,
  addDays,
  daysBetween,
  percentage,
  compact,
  exact,
  modelName,
  modelColor,
  normalize,
  filterRows,
  aggregate,
  periods,
  summarize,
} from "./analytics.mjs";
const $ = (id) => document.getElementById(id),
  el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem("chronicles") || "{}");
} catch {}
let data,
  rows = [],
  days = [],
  allModels = [],
  activeRows = [],
  view = saved.view || "daily",
  metric = Object.hasOwn(METRICS, saved.metric) ? saved.metric : "requests",
  grouping = saved.grouping || "eras",
  device = saved.device || "all",
  start = saved.start,
  end = saved.end;
let harnesses = new Set(saved.harnesses || Object.keys(HARNESSES)),
  models = new Set(saved.models || []),
  isDemo = false,
  initialized = false;
function persist() {
  try {
    localStorage.setItem(
      "chronicles",
      JSON.stringify({
        view,
        metric,
        grouping,
        device,
        start,
        end,
        harnesses: [...harnesses],
        models: [...models],
        excludeReview: $("exclude-review").checked,
      }),
    );
  } catch {}
}
function swatch(name) {
  const s = el("i", "swatch");
  s.style.background = modelColor(name);
  return s;
}
// Build the documented shadcn-html structure and connect its value to chart state.
function customSelect(id, label, choices) {
  const original = $(id),
    field = original.closest("label"),
    fieldWrapper = el("div", "select-field"),
    labelEl = el("span", "field-label", label),
    wrapper = el("div", "combobox"),
    trigger = el("button", "btn combobox-trigger"),
    valueLabel = el("span", "combobox-value"),
    chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    popup = el("div", "combobox-content"),
    list = el("div", "combobox-listbox");
  if (field.id) fieldWrapper.id = field.id;
  fieldWrapper.hidden = field.hidden;
  labelEl.id = id + "-label";
  trigger.id = id;
  trigger.type = "button";
  trigger.dataset.variant = "outline";
  trigger.dataset.size = "sm";
  wrapper.style.width = "14rem";
  valueLabel.id = id + "-value";
  trigger.setAttribute("aria-labelledby", labelEl.id + " " + valueLabel.id);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  popup.id = id + "-popup";
  popup.setAttribute("popover", "auto");
  list.id = id + "-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  trigger.setAttribute("aria-controls", popup.id);
  chevron.setAttribute("class", "combobox-chevron");
  chevron.setAttribute("aria-hidden", "true");
  chevron.setAttribute("width", "16");
  chevron.setAttribute("height", "16");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "2");
  chevron.innerHTML = '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>';
  list.tabIndex = -1;
  choices.forEach(([value, name], i) => {
    const item = el("div", "combobox-item", name);
    item.id = id + "-option-" + i;
    item.dataset.value = value;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    list.append(item);
  });
  trigger.append(valueLabel, chevron);
  popup.append(list);
  wrapper.append(trigger, popup);
  fieldWrapper.append(labelEl, wrapper);
  field.replaceWith(fieldWrapper);
  const component = window.ChroniclesCombobox.init(wrapper);
  let selected = choices[0][0];
  Object.defineProperty(trigger, "value", {
    get: () => selected,
    set: (value) => {
      selected = value;
      component.setValue(value);
    },
  });
  trigger.value = selected;
  wrapper.addEventListener("combobox:change", (event) => {
    selected = event.detail;
    trigger.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
customSelect("metric", "Metric", Object.entries(METRICS));
for (const [id, label] of [
  ["device", "Device"],
  ["grouping", "Group by"],
])
  customSelect(
    id,
    label,
    [...$(id).options].map((option) => [option.value, option.textContent]),
  );
$("exclude-review").checked = saved.excludeReview !== false;
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
systemTheme.addEventListener("change", () => {
  if (days.length) render();
});
function controls() {
  $("metric").value = metric;
  $("device").value = device;
  $("grouping").value = grouping;
  const available = historyHarnesses(rows);
  const existing = new Map([...$("harnesses").children].map(group => [group.querySelector("button").dataset.focusKey.slice(8), group]));
  const visible = new Set(available.map(([key]) => key));
  for (const [key, group] of existing) if (!visible.has(key)) group.remove();
  for (const [key, name] of available) {
    const group = existing.get(key) || el("div", "harness-group"),
      button = group.querySelector("button") || el("button", "toggle", name);
    button.dataset.variant = "outline";
    button.dataset.focusKey = "harness:" + key;
    button.setAttribute("aria-pressed", String(harnesses.has(key)));
    button.setAttribute("aria-label", `Toggle ${name}`);
    button.onclick = () => {
      harnesses.has(key) ? harnesses.delete(key) : harnesses.add(key);
      render();
    };
    if (!existing.has(key)) {
      group.append(button);
      $("harnesses").append(group);
    }
  }
  $("all-harnesses").disabled = !available.length;
  $("all-harnesses").textContent = available.length && available.every(([key]) => harnesses.has(key))
    ? "Deselect all"
    : "Select all";
  for (const id of ["start-date", "end-date", "start-slider", "end-slider"])
    $(id).disabled = !days.length;
  if (days.length) {
    for (const which of ["start", "end"]) {
      const input = $(which + "-date");
      input.min = days[0];
      input.max = days.at(-1);
      input.value = which === "start" ? start : end;
      const slider = $(which + "-slider");
      slider.max = days.length - 1;
      slider.value = daysBetween(days[0], input.value) - 1;
      slider.setAttribute("aria-valuetext", input.value);
    }
    const denominator = Math.max(1, days.length - 1),
      lo = ((daysBetween(days[0], start) - 1) / denominator) * 100,
      hi = ((daysBetween(days[0], end) - 1) / denominator) * 100;
    $("range-shade").style.left = `calc(6px + (100% - 12px) * ${lo / 100})`;
    $("range-shade").style.width = `calc((100% - 12px) * ${(hi - lo) / 100})`;
    $("first-date").textContent = days[0];
    $("last-date").textContent = days.at(-1);
  }
  document
    .querySelectorAll("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === view)),
    );
  $("daily-view").hidden = view !== "daily";
  $("bubble-view").hidden = view !== "bubbles";
  $("group-control").hidden = view !== "bubbles";
}
function render() {
  const focused = document.activeElement;
  const focusKey = focused?.dataset.focusKey;
  const keyboardFocus = focused?.matches(":focus-visible");
  if (!days.length || !start || !end) {
    controls();
    persist();
    return;
  }
  controls();
  persist();
  activeRows = filterRows(rows, {
    start,
    end,
    harnesses,
    models,
    device,
    excludeReview: $("exclude-review").checked,
  });
  if (metric === "rounds")
    activeRows = activeRows.filter((r) => r.provider === "copilot");
  const summary = summarize(activeRows, metric, start, end),
    isCount = ["requests", "rounds"].includes(metric),
    noTokens = !isCount && summary.missing > 0 && summary.total === 0;
  $("total").textContent = noTokens ? "Not recorded" : compact(summary.total);
  $("total").title = exact(summary.total);
  $("average").textContent = noTokens ? "—" : compact(summary.average);
  $("metric-caption").textContent = METRICS[metric];
  $("model-count").textContent = summary.models.length;
  const notes = [];
  if (summary.missing)
    notes.push(
      `${exact(summary.missing)} Copilot requests have no token values. They are included in request counts, but excluded from token totals.`,
    );
  if (metric === "rounds" && summary.roundMissing)
    notes.push(
      `${exact(summary.roundMissing)} requests have no saved response-round count.`,
    );
  if (data.legacyAntigravity && harnesses.has("antigravity"))
    notes.push(
      `${data.legacyAntigravity} legacy encrypted Antigravity conversations are not included.`,
    );
  if (!isCount && summary.missing && summary.total)
    notes.push("Token totals are partial.");
  $("notice").textContent = notes.join(" ");
  $("notice").hidden = !notes.length;
  $("chart-empty").hidden = summary.total > 0;
  $("chart-empty").textContent = noTokens
    ? "Token values were not recorded for these requests. Switch to Requests / calls."
    : "No usage matches these filters. Select a harness or model, or widen the date range.";
  const mini = Array(days.length).fill(0);
  for (const r of filterRows(rows, {
    start: days[0],
    end: days.at(-1),
    harnesses,
    models,
    device,
    excludeReview: $("exclude-review").checked,
  }))
    if (metric !== "rounds" || r.provider === "copilot")
      mini[daysBetween(days[0], r.date) - 1] += r[metric] || 0;
  const max = Math.max(1, ...mini);
  $("mini-chart").replaceChildren(
    ...mini.map((v) => {
      const n = el("div", "mini-bar");
      n.style.height = (v / max) * 100 + "%";
      return n;
    }),
  );
  renderModels();
  if (view === "daily") drawDaily();
  else drawBubbles();
  if (focusKey && keyboardFocus) {
    for (const button of document.querySelectorAll("[data-focus-key]"))
      if (button.dataset.focusKey === focusKey) {
        button.focus({ preventScroll: true });
        break;
      }
  }
}
function renderModels() {
  const available = filterRows(rows, {
      start,
      end,
      harnesses,
      models: new Set(allModels),
      device,
      excludeReview: $("exclude-review").checked,
    }),
    totals = new Map(aggregate(available, metric).map((r) => [r.model, r]));
  const existing = new Map([...$("models").children].map(group => [group.querySelector("button").dataset.focusKey.slice(6), group]));
  for (const [name, group] of existing) if (!allModels.includes(name)) group.remove();
  for (const name of allModels) {
    const group = existing.get(name) || el("div", "model-group"),
      button = group.querySelector("button") || el("button", "toggle model-chip");
    if (!existing.has(name)) {
      button.dataset.variant = "outline";
      button.dataset.focusKey = "model:" + name;
      button.append(swatch(name), document.createTextNode(modelName(name)));
      button.append(el("span", "model-value"));
      group.append(button);
      $("models").append(group);
    }
    const a = totals.get(name);
    button.querySelector(".model-value").textContent = a
          ? a.value
            ? compact(a.value)
            : a.missing && !["requests", "rounds"].includes(metric)
              ? "Not recorded"
              : "0"
          : "0";
    button.setAttribute("aria-pressed", String(models.has(name)));
    button.onclick = () => {
      models.has(name) ? models.delete(name) : models.add(name);
      render();
    };
  }
  $("all-models").textContent = allModels.every((m) => models.has(m))
    ? "Deselect all"
    : "Select all";
}
const svgNS = "http://www.w3.org/2000/svg";
function svgNode(tag, attrs, text) {
  const n = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function dailyData() {
  const map = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) map.set(d, new Map());
  for (const r of activeRows) {
    const m = map.get(r.date);
    m.set(r.model, (m.get(r.model) || 0) + (r[metric] || 0));
  }
  return map;
}
function drawDaily() {
  const chart = $("chart");
  chart.replaceChildren();
  $("tooltip").hidden = true;
  const daily = dailyData(),
    w = Math.max(280, chart.clientWidth),
    left = 58,
    top = 16,
    height = 236,
    width = w - left - 16,
    step = width / daily.size,
    max = Math.max(
      1,
      ...[...daily.values()].map((m) =>
        [...m.values()].reduce((s, v) => s + v, 0),
      ),
    );
  chart.setAttribute("viewBox", `0 0 ${w} 320`);
  for (let i = 0; i <= 4; i++) {
    const y = top + height - (i * height) / 4;
    chart.append(
      svgNode("line", { x1: left, x2: w - 16, y1: y, y2: y, class: "grid" }),
      svgNode(
        "text",
        { x: left - 10, y: y + 4, "text-anchor": "end", class: "axis" },
        compact((max * i) / 4),
      ),
    );
  }
  const order = aggregate(activeRows, metric).map((r) => r.model),
    ticks = Math.max(1, Math.ceil(daily.size / (w < 600 ? 4 : 9)));
  let i = 0;
  for (const [date, counts] of daily) {
    let y = top + height;
    for (const model of order) {
      const value = counts.get(model) || 0,
        h = (value / max) * height;
      if (h) {
        y -= h;
        chart.append(
          svgNode("rect", {
            x: left + i * step + step * 0.1,
            y,
            width: Math.max(0.3, step * 0.8),
            height: h,
            fill: modelColor(model),
          }),
        );
      }
    }
    const hit = svgNode("rect", {
      x: left + i * step,
      y: top,
      width: step,
      height,
      class: "day-hit",
      tabindex: 0,
      role: "img",
      "aria-label":
        date +
        ": " +
        exact([...counts.values()].reduce((s, v) => s + v, 0)) +
        " " +
        METRICS[metric],
    });
    hit.onpointermove = (e) => showTooltip(date, counts, e);
    hit.onfocus = (e) => showTooltip(date, counts, e);
    chart.append(hit);
    if (
      (i % ticks === 0 && daily.size - 1 - i >= ticks / 2) ||
      i === daily.size - 1
    )
      chart.append(
        svgNode(
          "text",
          {
            x: left + (i + 0.5) * step,
            y: 278,
            "text-anchor": "middle",
            class: "axis",
          },
          date.slice(5),
        ),
      );
    i++;
  }
  chart.append(
    svgNode(
      "text",
      { x: left, y: 306, class: "axis" },
      METRICS[metric] + " · " + (data.timezone || "UTC"),
    ),
  );
}
function showTooltip(date, counts, event) {
  const tip = $("tooltip");
  tip.replaceChildren(el("strong", "", date));
  for (const [model, value] of [...counts].sort((a, b) => b[1] - a[1]))
    if (value) {
      const row = el("div", "tip-row"),
        label = el("span");
      label.append(swatch(model), document.createTextNode(modelName(model)));
      row.append(label, el("span", "", exact(value)));
      tip.append(row);
    }
  tip.hidden = false;
  const box = $("chart-wrap").getBoundingClientRect(),
    target = event.target.getBoundingClientRect();
  tip.style.left =
    Math.max(
      0,
      Math.min(
        box.width - tip.offsetWidth,
        (event.clientX || target.x) - box.left + 12,
      ),
    ) + "px";
  tip.style.top =
    Math.max(
      0,
      Math.min(
        box.height - tip.offsetHeight,
        (event.clientY || target.y) - box.top,
      ),
    ) + "px";
}
$("chart").onpointerleave = () => {
  $("tooltip").hidden = true;
};
$("chart").onfocusout = () => {
  $("tooltip").hidden = true;
};
function drawBubbles() {
  const chapters = periods(activeRows, start, end, grouping).map((p) => ({
    ...p,
    ...summarize(
      activeRows.filter((r) => r.date >= p.start && r.date <= p.end),
      metric,
      p.start,
      p.end,
    ),
  }));
  const maxAverage = Math.max(1, ...chapters.map((p) => p.average)),
    maxCount = Math.max(
      1,
      ...chapters.flatMap((p) => p.models.map((m) => m.value)),
    );
  $("chapters").replaceChildren();
  const ranks = chapters.map((p) => p.models.filter((m) => m.value > 0));
  const rankCount = Math.max(0, ...ranks.map((m) => m.length));
  const rowHeights = Array.from(
    { length: rankCount },
    (_, rank) =>
      88 +
      Math.max(
        0,
        ...ranks.map((m) =>
          m[rank] ? 64 * Math.sqrt(m[rank].value / maxCount) : 0,
        ),
      ),
  );
  chapters.forEach((p, i) => {
    const column = el("section", "chapter"),
      head = el("div", "chapter-head"),
      date = el("div", "chapter-date");
    date.append(el("span", "", p.start), el("span", "", "→ " + p.end));
    head.append(date);
    const track = el("div", "avg-track"),
      bar = el("div", "avg-bar");
    bar.style.height = (p.average / maxAverage) * 90 + "px";
    track.append(bar);
    const unknown =
      !p.total && p.missing && !["requests", "rounds"].includes(metric);
    const perDay =
      metric === "requests"
        ? "Requests·calls/day"
        : metric === "total"
          ? "Total tokens/day"
          : METRICS[metric] + "/day";
    head.append(
      track,
      el("div", "chapter-average", unknown ? "—" : compact(p.average)),
      el("div", "chapter-meta", perDay),
      el(
        "div",
        "chapter-meta chapter-total",
        unknown ? "Not recorded" : compact(p.total) + " total",
      ),
    );
    const harnessCounts = new Map();
    for (const r of activeRows.filter(
      (r) => r.date >= p.start && r.date <= p.end,
    ))
      harnessCounts.set(
        r.provider,
        (harnessCounts.get(r.provider) || 0) + (r[metric] || 0),
      );
    const badges = el("div", "chapter-harnesses");
    for (const [k, v] of [...harnessCounts].sort((a, b) => b[1] - a[1]))
      if (v)
        badges.append(
          el(
            "span",
            "harness-badge",
            HARNESSES[k] + " " + percentage(v, p.total),
          ),
        );
    head.append(badges);
    column.append(head);
    ranks[i].forEach((m, rank) => {
      const model = el("div", "bubble-model");
      model.style.minHeight = rowHeights[rank] + "px";
      model.dataset.rank = rank;
      const circle = el("div", "bubble"),
        space = el("div", "bubble-space"),
        diameter = 64 * Math.sqrt(m.value / maxCount);
      circle.style.width = circle.style.height = diameter + "px";
      circle.style.background = modelColor(m.model);
      circle.setAttribute(
        "aria-label",
        modelName(m.model) + ": " + exact(m.value),
      );
      space.append(circle);
      model.append(
        el("div", "bubble-name", modelName(m.model)),
        space,
        el("div", "bubble-value", exact(m.value)),
        el("div", "bubble-share", percentage(m.value, p.total)),
      );
      column.append(model);
    });
    if (!p.total)
      column.append(
        el(
          "p",
          "chapter-meta",
          p.missing && !["requests", "rounds"].includes(metric)
            ? "Tokens not recorded"
            : "No records",
        ),
      );
    $("chapters").append(column);
  });
  const heads = [...$("chapters").querySelectorAll(".chapter-head")];
  const headHeight = Math.ceil(
    Math.max(0, ...heads.map((h) => h.getBoundingClientRect().height)),
  );
  for (const head of heads) head.style.height = headHeight + "px";
  for (let rank = 0; rank < rankCount; rank++) {
    const cells = [...$("chapters").querySelectorAll(`[data-rank="${rank}"]`)];
    const names = cells.map((cell) => cell.querySelector(".bubble-name"));
    const nameHeight = Math.ceil(
      Math.max(0, ...names.map((name) => name.getBoundingClientRect().height)),
    );
    for (const name of names) name.style.height = nameHeight + "px";
    const height = Math.ceil(
      Math.max(0, ...cells.map((cell) => cell.getBoundingClientRect().height)),
    );
    for (const cell of cells) cell.style.height = height + "px";
  }
}
function renderSources() {
  $("sources-panel").hidden = true;
  $("sources").replaceChildren();
  if (data.demo) return;
  for (const [id, name] of Object.entries(HARNESSES)) {
    const card = el("article", "source-card"),
      history = rows.filter((r) => r.provider === id),
      snapshots = (data.accountSnapshots || [])
        .filter((s) => s.provider === id)
        .map((s) => ({
          ...s,
          lines: (s.lines || []).filter(
            (line) =>
              line.label !== "Error" &&
              !["no data", "no usage data", "—"].includes(
                String(line.value || line.text || "").toLowerCase(),
              ),
          ),
        }));
    if (!snapshots.some((s) => s.lines?.length)) continue;
    card.append(el("h3", "", name));
    if (history.length)
      card.append(
        el(
          "p",
          "",
          `${exact(history.reduce((n, r) => n + r.requests, 0))} history records`,
        ),
      );
    for (const snapshot of snapshots) {
      if (snapshot.plan) card.append(el("p", "", snapshot.plan));
      if (snapshot.fetchedAt && !Number.isNaN(Date.parse(snapshot.fetchedAt)))
        card.append(
          el(
            "p",
            "",
            "Account updated " +
              new Date(snapshot.fetchedAt).toLocaleString("en"),
          ),
        );
      for (const line of snapshot.lines) {
        const row = el("div", "source-metric");
        row.append(el("span", "", line.label));
        let value = line.value || line.text || "No data";
        if (
          line.type === "progress" &&
          Number.isFinite(line.used) &&
          Number.isFinite(line.limit)
        ) {
          const kind = line.format?.kind;
          value =
            kind === "percent"
              ? `${exact(line.used)}%`
              : `${kind === "dollars" ? "$" : ""}${exact(line.used)} / ${exact(line.limit)}`;
        }
        row.append(el("strong", "", value));
        if (line.type === "barChart") {
          row.lastChild.textContent = "";
          card.append(row);
          const chart = el("div", "source-trend");
          const max = Math.max(1, ...(line.points || []).map((p) => p.value));
          for (const point of line.points || []) {
            const bar = el("div");
            bar.style.height = Math.max(1, (point.value / max) * 100) + "%";
            bar.title = `${point.label}: ${point.valueLabel || exact(point.value)}`;
            chart.append(bar);
          }
          chart.setAttribute("role", "img");
          chart.setAttribute(
            "aria-label",
            `${name} ${line.label}: ${(line.points || []).map((p) => p.label + " " + (p.valueLabel || exact(p.value))).join(", ")}`,
          );
          card.append(chart);
        } else card.append(row);
        if (line.subtitle || line.note)
          card.append(el("p", "", line.subtitle || line.note));
        if (line.type === "progress" && line.limit > 0) {
          const meter = el("progress");
          meter.max = line.limit;
          meter.value = Math.max(0, Math.min(line.used || 0, line.limit));
          meter.setAttribute("aria-label", `${name} ${line.label}`);
          card.append(meter);
        }
        if (line.resetsAt && !Number.isNaN(Date.parse(line.resetsAt)))
          card.append(
            el(
              "p",
              "",
              "Resets " + new Date(line.resetsAt).toLocaleString("en"),
            ),
          );
      }
    }
    $("sources").append(card);
    $("sources-panel").hidden = false;
  }
}
let latestLoad = 0;
async function load(endpoint = "/api/usage", reset = false) {
  const request = ++latestLoad;
  $("refresh").disabled = true;
  $("status").textContent = "Reading usage records…";
  try {
    const result =
      window.CHRONICLES_DATA ||
      (await fetch(endpoint).then((r) => {
        if (!r.ok)
          throw Error("Could not read usage. Check the server and refresh.");
        return r.json();
      }));
    if (request !== latestLoad) return;
    if (reset) {
      start = end = undefined;
      models = new Set();
      initialized = false;
      saved.models = undefined;
    }
    const knownModels = new Set(allModels);
    data = result;
    rows = normalize(data);
    isDemo = !!data.demo;
    renderSources();
    const dates = rows.map((r) => r.date).sort();
    allModels = [...new Set(rows.map((r) => r.model))].sort();
    if (!initialized) {
      models = new Set(saved.models || allModels);
      initialized = true;
    } else
      for (const name of allModels)
        if (!knownModels.has(name)) models.add(name);
    days = [];
    if (dates.length)
      for (let d = dates[0]; d <= dates.at(-1); d = addDays(d, 1)) days.push(d);
    if (!days.length) {
      controls();
      $("daily-view").hidden = false;
      $("bubble-view").hidden = true;
      $("chart").replaceChildren();
      $("chapters").replaceChildren();
      $("models").replaceChildren();
      $("total").textContent = "0";
      $("average").textContent = "0";
      $("model-count").textContent = "0";
      $("notice").hidden = true;
      $("chart-empty").hidden = false;
      $("chart-empty").textContent =
        "No records found. Try the demo or use a supported harness.";
      $("status").textContent =
        "No saved records found. Try demo, or use a supported coding harness and refresh.";
      $("source-label").textContent = "No local records";
      $("demo").textContent = "Preview demo";
      return;
    }
    start = start && start >= days[0] && start <= days.at(-1) ? start : days[0];
    end = end && end >= start && end <= days.at(-1) ? end : days.at(-1);
    render();
    $("source-label").textContent = isDemo
      ? "Synthetic demo data"
      : window.CHRONICLES_DATA
        ? "Exported snapshot"
        : "Local usage records";
    $("demo").textContent = isDemo ? "Back to local history" : "Preview demo";
    $("status").textContent = isDemo
      ? "Demo uses fictional records."
      : `${exact(data.files || 0)} source files · ${exact(data.events || 0)} token records${data.errors?.length ? " · Partial scan: " + data.errors.join(", ") : ""}`;
    $("updated").textContent =
      "Updated " +
      new Date(data.updatedAt).toLocaleString("en", {
        timeZone: data.timezone || "UTC",
      }) +
      " · " +
      (data.timezone || "UTC");
  } catch (error) {
    if (request === latestLoad) $("status").textContent = error.message;
  } finally {
    if (request === latestLoad) $("refresh").disabled = false;
  }
}
$("all-harnesses").onclick = () => {
  const available = historyHarnesses(rows).map(([key]) => key);
  const allSelected = available.every(key => harnesses.has(key));
  for (const key of available) {
    if (allSelected) harnesses.delete(key);
    else harnesses.add(key);
  }
  render();
};
$("all-models").onclick = () => {
  models = allModels.every((m) => models.has(m))
    ? new Set()
    : new Set(allModels);
  render();
};
$("metric").onchange = (e) => {
  metric = e.target.value;
  render();
};
$("device").onchange = (e) => {
  device = e.target.value;
  render();
};
$("grouping").onchange = (e) => {
  grouping = e.target.value;
  render();
};
$("exclude-review").onchange = render;
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      view = b.dataset.view;
      render();
    }),
);
for (const which of ["start", "end"]) {
  const setDate = (value) => {
    if (!value || !days.length) return;
    let d =
      value < days[0] ? days[0] : value > days.at(-1) ? days.at(-1) : value;
    if (which === "start") start = d > end ? end : d;
    else end = d < start ? start : d;
    render();
  };
  $(which + "-date").onchange = (e) => setDate(e.target.value);
  $(which + "-slider").oninput = (e) => setDate(days[Number(e.target.value)]);
}
// One pointer surface chooses the nearest endpoint, including coincident thumbs.
const rangeTrack = document.querySelector(".range-track");
let rangeDrag, rangeCoincident;
const rangeIndex = (event) => {
  const box = rangeTrack.getBoundingClientRect();
  return Math.max(0, Math.min(days.length - 1, Math.round((event.clientX - box.left - 6) / Math.max(1, box.width - 12) * (days.length - 1))));
};
const moveRange = (event) => {
  const index = rangeIndex(event);
  if (rangeCoincident !== undefined && index !== rangeCoincident) {
    rangeDrag = index < rangeCoincident ? "start" : "end";
    rangeCoincident = undefined;
    $(rangeDrag + "-slider").focus({preventScroll: true});
  }
  const previousStart = start, previousEnd = end;
  if (rangeDrag === "start") start = days[Math.min(index, daysBetween(days[0], end) - 1)];
  else end = days[Math.max(index, daysBetween(days[0], start) - 1)];
  if (start !== previousStart || end !== previousEnd) render();
};
rangeTrack.addEventListener("pointerdown", (event) => {
  if (!days.length || !start || !end || event.button !== 0) return;
  event.preventDefault();
  const index = rangeIndex(event), lo = daysBetween(days[0], start) - 1, hi = daysBetween(days[0], end) - 1;
  rangeDrag = Math.abs(index - lo) < Math.abs(index - hi) || (lo === hi && index <= lo) ? "start" : "end";
  rangeCoincident = lo === hi && index === lo ? lo : undefined;
  rangeTrack.setPointerCapture(event.pointerId);
  $(rangeDrag + "-slider").focus({preventScroll: true});
  $(rangeDrag + "-slider").dataset.dragging = "";
  moveRange(event);
});
rangeTrack.addEventListener("pointermove", (event) => {
  if (rangeDrag) moveRange(event);
  else if (days.length && start && end) {
    const index = rangeIndex(event);
    const nearest = Math.abs(index - Number($("start-slider").value)) <= Math.abs(index - Number($("end-slider").value)) ? "start" : "end";
    for (const which of ["start", "end"]) {
      if (which === nearest) $(which + "-slider").dataset.hover = "";
      else delete $(which + "-slider").dataset.hover;
    }
  }
});
rangeTrack.addEventListener("pointerleave", () => {
  for (const which of ["start", "end"]) delete $(which + "-slider").dataset.hover;
});
for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) rangeTrack.addEventListener(event, () => {
  rangeDrag = rangeCoincident = undefined;
  for (const which of ["start", "end"]) delete $(which + "-slider").dataset.dragging;
});
document.querySelectorAll("[data-days]").forEach(
  (b) =>
    (b.onclick = () => {
      if (!days.length) return;
      end = days.at(-1);
      start =
        b.dataset.days === "all"
          ? days[0]
          : [days[0], addDays(end, 1 - Number(b.dataset.days))].sort().at(-1);
      render();
    }),
);
$("refresh").onclick = () => load(isDemo ? "/api/demo" : "/api/usage");
$("demo").onclick = () => load(isDemo ? "/api/local" : "/api/demo", true);
$("export").onclick = () => {
  const fields = [
    "date",
    "provider",
    "device",
    "model",
    "requests",
    "rounds",
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "total",
    "tokenRecorded",
  ];
  const csv = [
    fields.join(","),
    ...activeRows.map((r) =>
      fields
        .map(
          (f) =>
            '"' +
            String(
              !r.tokenRecorded &&
                [
                  "input",
                  "output",
                  "cacheRead",
                  "cacheWrite",
                  "total",
                ].includes(f)
                ? ""
                : (r[f] ?? ""),
            ).replaceAll('"', '""') +
            '"',
        )
        .join(","),
    ),
  ].join("\n");
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `chronicles-${start}-${end}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
if (window.CHRONICLES_DATA) {
  $("demo").hidden = true;
  $("refresh").setAttribute("aria-label", "Reload snapshot");
}
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (rows.length && view === "daily") drawDaily();
  }, 100);
}).observe($("chart-wrap"));
load();

let chapterResizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(chapterResizeTimer);
  chapterResizeTimer = setTimeout(() => {
    if (rows.length && view === "bubbles") drawBubbles();
  }, 100);
});
