import {
  HARNESSES,
  historyHarnesses,
  METRICS,
  addDays,
  calendarDate,
  rankingFrames,
  rankingAxis,
  formatMetric,
  formatAverage,
  daysBetween,
  percentage,
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
  const current = localStorage.getItem("Chronicles");
  const legacyKey = "Chronicles".toLowerCase();
  const legacy = localStorage.getItem(legacyKey);
  saved = JSON.parse(current || legacy || "{}");
  if (current === null && legacy !== null) {
    localStorage.setItem("Chronicles", legacy);
  }
  localStorage.removeItem(legacyKey);
} catch {}
let data,
  rows = [],
  days = [],
  allModels = [],
  activeRows = [],
  view = ["daily", "bubbles", "race"].includes(saved.view) ? saved.view : "daily",
  metric = Object.hasOwn(METRICS, saved.metric) ? saved.metric : "requests",
  grouping = saved.grouping || "eras",
  device = saved.device || "all",
  start = saved.start,
  end;
let harnesses = new Set(saved.harnesses || Object.keys(HARNESSES)),
  models = new Set(saved.models || []),
  isDemo = false,
  initialized = false;
function persist() {
  try {
    localStorage.setItem(
      "Chronicles",
      JSON.stringify({
        view,
        metric,
        grouping,
        device,
        start,
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
function customSelect(id, label, choices, hideLabel = false) {
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
  if (hideLabel) labelEl.classList.add("sr-only");
  trigger.id = id;
  trigger.type = "button";
  trigger.dataset.variant = "outline";
  trigger.dataset.size = "sm";
  wrapper.style.width = {metric: "13.25rem", device: "8.4rem"}[id] || "14rem";
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
  let selected = choices.some(([value]) => value === original.value) ? original.value : choices[0][0];
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
function calendarDatePicker(id, label) {
  const original = $(id), field = original.closest("label"),
    wrapper = el("div", "date-field"), labelEl = el("span", "field-label", label),
    trigger = el("button", "btn date-trigger"), valueEl = el("span"),
    popup = el("div", "date-popover"), cal = el("div", "calendar");
  labelEl.id = id + "-label";
  trigger.id = id;
  trigger.type = "button";
  trigger.disabled = true;
  trigger.dataset.variant = "outline";
  trigger.setAttribute("aria-labelledby", labelEl.id + " " + id + "-value");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  popup.id = id + "-popup";
  popup.setAttribute("popover", "auto");
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", label + " date");
  trigger.setAttribute("aria-controls", popup.id);
  trigger.setAttribute("popovertarget", popup.id);
  trigger.setAttribute("popovertargetaction", "toggle");
  valueEl.id = id + "-value";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.8");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>';
  cal.innerHTML = '<div class="calendar-header"><button type="button" class="calendar-nav" data-action="prev-month" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><span class="calendar-heading" aria-live="polite"></span><button type="button" class="calendar-nav" data-action="next-month" aria-label="Next month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div><table class="calendar-grid" role="grid"></table>';
  trigger.append(valueEl, icon);
  popup.append(cal);
  wrapper.append(labelEl, trigger, popup);
  field.replaceWith(wrapper);
  trigger.calendar = window.ChroniclesCalendar.init(cal);
  let selected = original.value;
  Object.defineProperty(trigger, "value", {
    get: () => selected,
    set: value => { selected = value; valueEl.textContent = value || "Choose date"; },
  });
  trigger.value = selected;
  const position = () => {
    if (!popup.matches(":popover-open")) return;
    const box = trigger.getBoundingClientRect(), size = popup.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(box.left, innerWidth - size.width - 8)) + "px";
    popup.style.top = Math.max(8, Math.min(box.bottom + 6, innerHeight - size.height - 8)) + "px";
  };
  popup.addEventListener("toggle", () => {
    const open = popup.matches(":popover-open");
    trigger.setAttribute("aria-expanded", String(open));
    if (open) { trigger.calendar.open(); position(); }
  });
  cal.addEventListener("calendar:select", event => {
    trigger.value = event.detail.value;
    popup.hidePopover();
    trigger.focus({preventScroll: true});
    trigger.dispatchEvent(new Event("change", {bubbles: true}));
  });
  popup.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    popup.hidePopover();
    trigger.focus({preventScroll: true});
  });
  popup.addEventListener("focusout", event => {
    if (event.relatedTarget && !popup.contains(event.relatedTarget)) popup.hidePopover();
  });
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  for (const event of ["click", "keydown"]) cal.addEventListener(event, () => queueMicrotask(position));
}
for (const [id, label] of [["start-date", "From"], ["end-date", "To"]]) calendarDatePicker(id, label);
customSelect("metric", "Metric", Object.entries(METRICS));
for (const [id, label] of [
  ["device", "Device"],
  ["grouping", "Group by"],
  ["race-mode", "Ranking"],
  ["race-speed", "Playback speed"],
])
  customSelect(
    id,
    label,
    [...$(id).options].map((option) => [option.value, option.textContent]),
    ["race-mode", "race-speed"].includes(id),
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
      input.calendar.setOptions({
        selected: input.value,
        min: which === "start" ? days[0] : start,
        max: which === "start" ? end : days.at(-1),
        today: calendarDate(data.timezone || "UTC"),
      });
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
  $("race-view").hidden = view !== "race";
  $("race-options").hidden = view !== "race";
  $("group-control").hidden = view !== "bubbles";
}
function render() {
  pauseRace();
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
  $("total").textContent = noTokens ? "Not recorded" : formatMetric(summary.total, metric);
  $("total").title = exact(summary.total);
  $("average").textContent = noTokens ? "—" : formatAverage(summary.average, metric);
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
  drawMini();
  renderModels();
  if (view === "daily") drawDaily();
  else if (view === "bubbles") drawBubbles();
  else drawRace();
  if (focusKey && keyboardFocus) {
    for (const button of document.querySelectorAll("[data-focus-key]"))
      if (button.dataset.focusKey === focusKey) {
        button.focus({ preventScroll: true });
        break;
      }
  }
}
function drawMini() {
  const chart = $("mini-chart");
  // Reserve two pixels per bar plus its gap, combining days on narrow screens.
  const count = Math.max(1, Math.min(days.length, Math.floor((chart.clientWidth + 1) / 3))),
    mini = Array(count).fill(0);
  for (const r of filterRows(rows, {
    start: days[0],
    end: days.at(-1),
    harnesses,
    models,
    device,
    excludeReview: $("exclude-review").checked,
  }))
    if (metric !== "rounds" || r.provider === "copilot")
      mini[Math.floor((daysBetween(days[0], r.date) - 1) * count / days.length)] += r[metric] || 0;
  const max = Math.max(1, ...mini);
  chart.replaceChildren(
    ...mini.map((v) => {
      const n = el("div", "mini-bar");
      n.style.height = (v / max) * 100 + "%";
      return n;
    }),
  );
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
  const rankedModels = [...allModels].sort((a, b) =>
    (totals.get(b)?.value || 0) - (totals.get(a)?.value || 0) || a.localeCompare(b),
  );
  for (const name of rankedModels) {
    const group = existing.get(name) || el("div", "model-group"),
      button = group.querySelector("button") || el("button", "btn model-chip");
    if (!existing.has(name)) {
      button.dataset.variant = "ghost";
      button.dataset.focusKey = "model:" + name;
      button.append(swatch(name), el("span", "model-name", modelName(name)));
      button.querySelector(".model-name").title = modelName(name);
      button.append(el("span", "model-value"));
      group.append(button);
    }
    $("models").append(group);
    const a = totals.get(name);
    group.hidden = !a || (!a.value && !(a.missing && !["requests", "rounds"].includes(metric)));
    button.querySelector(".model-value").textContent = a
          ? a.value
            ? formatMetric(a.value, metric)
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
    left = 76,
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
        formatMetric((max * i) / 4, metric),
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
      row.append(label, el("span", "", formatMetric(value, metric)));
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
      64 +
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
      el("div", "chapter-average", unknown ? "—" : formatAverage(p.average, metric)),
      el("div", "chapter-meta", perDay),
      el(
        "div",
        "chapter-meta chapter-total",
        unknown ? "Not recorded" : formatMetric(p.total, metric) + " total",
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
        el("div", "bubble-value", formatMetric(m.value, metric)),
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
let raceFrames = [], raceIndex = 0, racePosition = 0, racePlaying = false;
let raceRows = new Map();
let raceAnimation, raceAxisMaximum = 0, racePaintAt = 0;
const raceStepMs = 1000 / 2;
function pauseRace() {
  cancelAnimationFrame(raceAnimation);
  racePlaying = false;
  $("race-play").textContent = "Play";
  $("race-play").setAttribute("aria-label", "Play rankings");
}
function paintRace(position) {
  racePosition = Math.min(position, Math.max(0, raceFrames.length - 1));
  raceIndex = Math.floor(racePosition);
  const frame = raceFrames[raceIndex];
  if (!frame) return;
  const next = raceFrames[Math.min(raceIndex + 1, raceFrames.length - 1)];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fraction = reducedMotion ? 0 : racePosition - raceIndex;
  const now = performance.now(), elapsed = Math.max(0, now - racePaintAt);
  racePaintAt = now;
  const widthBlend = racePlaying && !reducedMotion ? 1 - Math.exp(-elapsed / 90) : 1;
  const move = fraction * fraction * (3 - 2 * fraction);
  $("race-date").textContent = frame.date;
  $("race-date").dateTime = frame.date;
  const sliderPosition = reducedMotion ? raceIndex : racePosition;
  $("race-slider").value = sliderPosition;
  $("race-slider").style.setProperty("--slider-value", `${100 * sliderPosition / Math.max(1, raceFrames.length - 1)}%`);
  $("race-slider").setAttribute("aria-valuetext", frame.date);
  $("race-progress").textContent = `${raceIndex + 1} / ${raceFrames.length}`;
  $("race-empty").hidden = frame.ranking.length > 0 || (fraction > 0 && next.ranking.length > 0);
  const currentHeight = Math.max(1, frame.ranking.length) * 54;
  const nextHeight = Math.max(1, next.ranking.length) * 54;
  const height = currentHeight + (nextHeight - currentHeight) * fraction;
  $("race-board").style.height = height + "px";
  const maximum = Math.max(1, ...frame.ranking.map(row => row.value));
  const nextMaximum = Math.max(1, ...next.ranking.map(row => row.value));
  const axis = rankingAxis(maximum + (nextMaximum - maximum) * fraction);
  const scaleMaximum = axis.maximum;
  $("race-unit").textContent = metric === "requests" ? "Requests" : metric === "rounds" ? "Rounds" : "Tokens";
  if (raceAxisMaximum !== scaleMaximum) {
    raceAxisMaximum = scaleMaximum;
    $("race-axis").querySelector(".race-scale").replaceChildren(...axis.ticks.map((value, index) => {
      const tick = el("span", "race-tick", formatMetric(value, metric));
      tick.style.left = `${100 * value / scaleMaximum}%`;
      if (index === Math.floor((axis.ticks.length - 1) / 2)) tick.dataset.midpoint = "";
      return tick;
    }));
    $("race-board").querySelector(".race-grid-lines").replaceChildren(...axis.ticks.map((value, index) => {
      const line = el("i");
      line.style.left = `${100 * value / scaleMaximum}%`;
      if (index === Math.floor((axis.ticks.length - 1) / 2)) line.dataset.midpoint = "";
      return line;
    }));
  }
  const current = new Map(frame.ranking.map((row, index) => [row.model, {...row, rank: index}]));
  const upcoming = new Map(next.ranking.map((row, index) => [row.model, {...row, rank: index}]));
  const primary = fraction < 0.5 ? current : upcoming;
  for (const [name, row] of raceRows) {
    const from = current.get(name), to = upcoming.get(name);
    const fromY = from ? from.rank * 54 : currentHeight + 10;
    const toY = to ? to.rank * 54 : nextHeight + 10;
    const value = (from?.value || 0) + ((to?.value || 0) - (from?.value || 0)) * fraction;
    const width = 100 * value / scaleMaximum;
    row.style.transform = `translateY(${fromY + (toY - fromY) * move}px)`;
    row.style.opacity = from && to ? "1" : from ? 1 - fraction : to ? fraction : "0";
    const ranked = primary.get(name);
    row.setAttribute("aria-hidden", String(!ranked));
    const bar = row.querySelector(".race-bar");
    if (!from && !to) { bar.style.width = "0%"; continue; }
    row.querySelector(".race-rank").textContent = (ranked?.rank ?? from?.rank ?? to.rank) + 1;
    const counter = row.querySelector(".race-value");
    counter.dataset.value = value;
    counter.textContent = formatMetric(Math.round(value), metric);
    counter.title = exact(value);
    const previousWidth = parseFloat(bar.style.width) || 0;
    bar.style.width = `${previousWidth + (width - previousWidth) * widthBlend}%`;
    if (ranked) {
      row.setAttribute("aria-posinset", ranked.rank + 1);
      row.setAttribute("aria-setsize", primary.size);
      row.setAttribute("aria-label", `${ranked.rank + 1}. ${modelName(name)}: ${exact(value)} ${METRICS[metric]}`);
    }
  }
}
function showRaceFrame() {
  paintRace(raceIndex);
  for (const item of raceFrames[raceIndex]?.ranking || []) $("race-board").append(raceRows.get(item.model));
}
function drawRace(position = 0) {
  cancelAnimationFrame(raceAnimation);
  const mode = $("race-mode").value;
  let raceHistory = mode === "cumulative" ? activeRows : filterRows(rows, {
    start: addDays(start, mode === "month" ? -29 : -6),
    end,
    harnesses,
    models,
    device,
    excludeReview: $("exclude-review").checked,
  });
  if (metric === "rounds") raceHistory = raceHistory.filter(row => row.provider === "copilot");
  raceFrames = rankingFrames(raceHistory, start, end, metric, mode);
  raceIndex = Math.floor(Math.min(position, Math.max(0, raceFrames.length - 1)));
  raceRows = new Map();
  raceAxisMaximum = 0;
  $("race-board").replaceChildren();
  const grid = el("div", "race-grid race-columns"), lines = el("div", "race-grid-lines");
  grid.setAttribute("aria-hidden", "true");
  grid.append(lines);
  $("race-board").append(grid);
  const names = new Set(raceFrames.flatMap(frame => frame.ranking.map(row => row.model)));
  for (const name of names) {
    const row = el("div", "race-row");
    row.setAttribute("role", "listitem");
    row.style.opacity = "0";
    const track = el("div", "race-track"), bar = el("div", "race-bar");
    bar.style.background = modelColor(name);
    track.append(bar);
    row.append(el("span", "race-rank"), el("span", "race-name", modelName(name)), track, el("span", "race-value"));
    raceRows.set(name, row);
    $("race-board").append(row);
  }
  $("race-slider").max = Math.max(0, raceFrames.length - 1);
  $("race-slider").disabled = !raceFrames.length;
  $("race-play").disabled = raceFrames.length < 2 || !names.size;
  $("race-restart").disabled = !raceFrames.length;
  showRaceFrame();
  if (position !== raceIndex) paintRace(position);
}
function scheduleRace() {
  racePaintAt = performance.now();
  const stepMs = raceStepMs / Number($("race-speed").value);
  const started = performance.now() - racePosition * stepMs;
  const advance = now => {
    if (!racePlaying || view !== "race") return;
    paintRace((now - started) / stepMs);
    if (racePosition >= raceFrames.length - 1) { pauseRace(); showRaceFrame(); }
    else raceAnimation = requestAnimationFrame(advance);
  };
  raceAnimation = requestAnimationFrame(advance);
}
$("race-play").onclick = () => {
  if (racePlaying) return pauseRace();
  if (racePosition >= raceFrames.length - 1) {
    raceIndex = 0;
    showRaceFrame();
  }
  racePlaying = true;
  $("race-play").textContent = "Pause";
  $("race-play").setAttribute("aria-label", "Pause rankings");
  scheduleRace();
};
$("race-restart").onclick = () => { pauseRace(); raceIndex = 0; showRaceFrame(); };
$("race-slider").oninput = event => { pauseRace(); raceIndex = Number(event.target.value); showRaceFrame(); };
$("race-slider").onkeydown = event => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  pauseRace();
  const forward = ["ArrowRight", "ArrowUp"].includes(event.key);
  raceIndex = Math.max(0, Math.min(raceFrames.length - 1,
    forward ? Math.floor(racePosition) + 1 : Math.ceil(racePosition) - 1));
  showRaceFrame();
};
$("race-mode").onchange = () => { pauseRace(); drawRace(racePosition); };
$("race-speed").onchange = () => {
  if (!racePlaying) return;
  cancelAnimationFrame(raceAnimation);
  scheduleRace();
};
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseRace(); });

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
  $("status").hidden = false;
  try {
    let result =
      window.CHRONICLES_DATA ||
      (await fetch(endpoint).then((r) => {
        if (!r.ok)
          throw Error("Could not read usage. Check the server and refresh.");
        return r.json();
      }));
    if (request !== latestLoad) return;
    let previewFallback = false;
    if (!window.CHRONICLES_DATA && !result.demo && !normalize(result).length) {
      const response = await fetch("/api/demo");
      if (!response.ok) throw Error("No local usage records found. Preview demo could not load.");
      result = await response.json();
      previewFallback = true;
      if (request !== latestLoad) return;
    }
    if (isDemo !== !!result.demo) reset = true;
    if (reset) {
      start = end = undefined;
      models = new Set();
      initialized = false;
      saved.models = undefined;
      if (result.demo) harnesses = new Set(Object.keys(HARNESSES));
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
    const followLatest = !end || end === days.at(-1);
    const lastDate = !isDemo && !window.CHRONICLES_DATA
      ? [dates.at(-1), calendarDate(data.timezone || "UTC")].filter(Boolean).sort().at(-1)
      : dates.at(-1);
    days = [];
    if (dates.length)
      for (let d = dates[0]; d <= lastDate; d = addDays(d, 1)) days.push(d);
    if (!days.length) {
      pauseRace();
      raceFrames = [];
      cancelAnimationFrame(raceAnimation);
      raceRows.clear();
      $("race-board").replaceChildren();
      $("race-view").hidden = true;
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
        "No usage records found. Use a supported harness and refresh.";
      $("status").textContent =
        "No local usage records found.";
      return;
    }
    start = start && start >= days[0] && start <= days.at(-1) ? start : days[0];
    end = !followLatest && end >= start && end <= days.at(-1) ? end : days.at(-1);
    render();
    $("status").textContent = isDemo
      ? previewFallback ? "No local usage records found. This is a preview demo with fictional data." : "This is a preview demo with fictional data."
      : data.errors?.length ? "Partial scan: " + data.errors.join(", ") : "";
    $("status").hidden = !$("status").textContent;
    $("updated").textContent =
      "Updated " +
      new Date(data.updatedAt).toLocaleString("en", {
        timeZone: data.timezone || "UTC",
      }) +
      " · " +
      (data.timezone || "UTC");
  } catch (error) {
    if (request === latestLoad) { $("status").textContent = error.message; $("status").hidden = false; }
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
$("refresh").onclick = () => load();
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
  a.download = `Chronicles-${start}-${end}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
if (window.CHRONICLES_DATA) {
  $("refresh").setAttribute("aria-label", "Reload snapshot");
}
let resizeTimer;
const chartResizeObserver = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (days.length) drawMini();
    if (rows.length && view === "daily") drawDaily();
  }, 100);
});
chartResizeObserver.observe($("chart-wrap"));
chartResizeObserver.observe($("mini-chart"));
load();

let chapterResizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(chapterResizeTimer);
  chapterResizeTimer = setTimeout(() => {
    if (rows.length && view === "bubbles") drawBubbles();
  }, 100);
});
