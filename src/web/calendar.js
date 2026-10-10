/* Adapted from shadcn-html calendar.js at 0964e09e16034e39a244589d457a866171991f1d.
 * MIT, Copyright (c) 2026 Cody Lindley. Full license: shadcn.css.
 * Integration: controlled selection, inclusive date bounds, UTC calendar arithmetic,
 * roving focus across month boundaries, and an explicit initializer for date popovers.
 */
(() => {
  const parse = value => new Date(value + "T00:00:00Z");
  const iso = date => date.toISOString().slice(0, 10);
  const shift = (value, days) => iso(new Date(parse(value).getTime() + days * 86400000));
  const monthDate = (year, month, day = 1) => iso(new Date(Date.UTC(year, month, day)));
  const monthLabel = new Intl.DateTimeFormat("en", {month: "long", year: "numeric", timeZone: "UTC"});
  const dayLabel = new Intl.DateTimeFormat("en", {dateStyle: "full", timeZone: "UTC"});
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function init(cal) {
    cal.dataset.init = "";
    const grid = cal.querySelector(".calendar-grid"), heading = cal.querySelector(".calendar-heading");
    let options = {}, month = "", focused = "";
    const allowed = value => (!options.min || value >= options.min) && (!options.max || value <= options.max);
    const monthAllowed = value => {
      const date = parse(value), year = date.getUTCFullYear(), index = date.getUTCMonth();
      return (!options.min || monthDate(year, index + 1, 0) >= options.min)
        && (!options.max || monthDate(year, index) <= options.max);
    };
    const render = () => {
      if (!month) return;
      const date = parse(month), year = date.getUTCFullYear(), index = date.getUTCMonth();
      const total = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
      const startDay = date.getUTCDay();
      heading.textContent = monthLabel.format(date);
      grid.setAttribute("aria-label", heading.textContent);
      cal.querySelector('[data-action="prev-month"]').disabled = !monthAllowed(monthDate(year, index - 1));
      cal.querySelector('[data-action="next-month"]').disabled = !monthAllowed(monthDate(year, index + 1));
      const visible = Array.from({length: Math.ceil((startDay + total) / 7) * 7}, (_, day) => shift(month, day - startDay));
      if (!visible.includes(focused) || !allowed(focused))
        focused = visible.find(value => value === options.selected && allowed(value))
          || visible.find(value => value.slice(0, 7) === month.slice(0, 7) && allowed(value));
      let html = '<thead><tr>' + weekdays.map(day => `<th class="calendar-day-label" scope="col" abbr="${day}">${day.slice(0, 2)}</th>`).join("") + '</tr></thead><tbody>';
      visible.forEach((value, day) => {
        if (day % 7 === 0) html += '<tr>';
        const disabled = !allowed(value), selected = value === options.selected;
        html += `<td class="calendar-day" aria-selected="${selected}"${value.slice(0, 7) !== month.slice(0, 7) ? ' data-outside' : ''}${value === options.today ? ' data-today' : ''}${selected ? ' data-selected' : ''}${disabled ? ' data-disabled' : ''}><button type="button" data-date="${value}" aria-label="${dayLabel.format(parse(value))}" tabindex="${value === focused ? 0 : -1}"${disabled ? ' disabled' : ''}>${parse(value).getUTCDate()}</button></td>`;
        if (day % 7 === 6) html += '</tr>';
      });
      grid.innerHTML = html + '</tbody>';
    };
    const focusDate = value => {
      if (!allowed(value)) return;
      focused = value;
      if (value.slice(0, 7) !== month.slice(0, 7)) month = value.slice(0, 7) + "-01";
      render();
      grid.querySelector(`[data-date="${value}"]`)?.focus();
    };
    cal.addEventListener("click", event => {
      const nav = event.target.closest(".calendar-nav");
      if (nav && !nav.disabled) {
        const date = parse(month);
        month = monthDate(date.getUTCFullYear(), date.getUTCMonth() + (nav.dataset.action === "prev-month" ? -1 : 1));
        focused = "";
        render();
        return;
      }
      const button = event.target.closest(".calendar-day button");
      if (!button || button.disabled || !allowed(button.dataset.date)) return;
      options.selected = button.dataset.date;
      focused = options.selected;
      month = focused.slice(0, 7) + "-01";
      render();
      cal.dispatchEvent(new CustomEvent("calendar:select", {
        detail: {value: options.selected, date: parse(options.selected)}, bubbles: true,
      }));
    });
    cal.addEventListener("focusin", event => {
      const button = event.target.closest(".calendar-day button");
      if (!button) return;
      focused = button.dataset.date;
      grid.querySelectorAll("button").forEach(day => { day.tabIndex = day === button ? 0 : -1; });
    });
    cal.addEventListener("keydown", event => {
      const button = event.target.closest(".calendar-day button");
      if (!button) return;
      const value = button.dataset.date, date = parse(value);
      let target;
      switch (event.key) {
        case "ArrowRight": target = shift(value, 1); break;
        case "ArrowLeft": target = shift(value, -1); break;
        case "ArrowDown": target = shift(value, 7); break;
        case "ArrowUp": target = shift(value, -7); break;
        case "Home": target = shift(value, -date.getUTCDay()); break;
        case "End": target = shift(value, 6 - date.getUTCDay()); break;
        case "PageUp":
        case "PageDown": {
          const index = date.getUTCMonth() + (event.key === "PageUp" ? -1 : 1);
          const last = new Date(Date.UTC(date.getUTCFullYear(), index + 1, 0)).getUTCDate();
          target = monthDate(date.getUTCFullYear(), index, Math.min(last, date.getUTCDate()));
          break;
        }
        default: return;
      }
      event.preventDefault();
      if (options.min && target < options.min) target = options.min;
      if (options.max && target > options.max) target = options.max;
      focusDate(target);
    });
    return {
      setOptions(next) {
        options = {...options, ...next};
        if (!month && options.selected) month = options.selected.slice(0, 7) + "-01";
        render();
      },
      open() {
        focused = options.selected || options.min || options.today;
        if (!focused) return;
        month = focused.slice(0, 7) + "-01";
        render();
        grid.querySelector(`[data-date="${focused}"]`)?.focus();
      },
    };
  }
  window.ChroniclesCalendar = {init};
})();
