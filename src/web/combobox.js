/* Adapted from shadcn-html combobox.js at 0964e09e16034e39a244589d457a866171991f1d.
 * MIT, Copyright (c) 2026 Cody Lindley. Full license: shadcn.css.
 * Integration changes: declarative popover invoker, change event/value adapter,
 * selected-option highlight, and positioning fallback. Search is omitted for these short option lists; keyboard navigation retains
 * the upstream implementation.
 */
(() => {
  function init(wrapper) {
    wrapper.dataset.init = "";
    const trigger = wrapper.querySelector(".combobox-trigger");
    const valueEl = wrapper.querySelector(".combobox-value");
    const popover = wrapper.querySelector(".combobox-content");
    const listboxFocus = wrapper.querySelector('[role="listbox"]');
    const listbox = wrapper.querySelector('[role="listbox"]');
    if (!trigger || !popover || !listboxFocus || !listbox) return;

    const allItems = Array.from(listbox.querySelectorAll('[role="option"]'));
    let highlighted = -1;

    // CSS anchor positioning - unique name per trigger-popover pair
    const anchorId = `--combobox-${popover.id}`;
    trigger.style.anchorName = anchorId;
    popover.style.positionAnchor = anchorId;

    const position = () => {
      if (CSS.supports("top", "anchor(bottom)")) return;
      const box = trigger.getBoundingClientRect();
      const width = Math.min(innerWidth - 16, box.width);
      popover.style.width = width + "px";
      popover.style.left =
        Math.max(8, Math.min(box.left, innerWidth - width - 8)) + "px";
      const height = popover.getBoundingClientRect().height;
      popover.style.top =
        (box.bottom + height + 8 > innerHeight && box.top > height
          ? box.top - height - 8
          : box.bottom) + "px";
    };
    const getVisibleItems = () =>
      allItems.filter(
        (item) => !item.hidden && item.getAttribute("aria-disabled") !== "true",
      );
    const open = () => {
      popover.showPopover();
      trigger.setAttribute("aria-expanded", "true");
      position();
      listboxFocus.focus();
    };
    const close = () => {
      popover.hidePopover();
      trigger.setAttribute("aria-expanded", "false");
      listboxFocus.setAttribute("aria-activedescendant", "");
      clearHighlight();
      trigger.focus();
    };
    const isOpen = () => popover.matches(":popover-open");
    const clearHighlight = () => {
      allItems.forEach((item) => {
        delete item.dataset.highlighted;
      });
      highlighted = -1;
    };
    const doHighlight = (index) => {
      const items = getVisibleItems();
      clearHighlight();
      if (index < 0 || index >= items.length) return;
      highlighted = index;
      items[index].dataset.highlighted = "";
      items[index].scrollIntoView({ block: "nearest" });
      listboxFocus.setAttribute("aria-activedescendant", items[index].id);
    };
    const selectItem = (item) => {
      if (item.getAttribute("aria-disabled") === "true") return;
      allItems.forEach((i) => {
        i.setAttribute("aria-selected", "false");
      });
      item.setAttribute("aria-selected", "true");
      if (valueEl) {
        valueEl.textContent = item.textContent.trim();
        valueEl.removeAttribute("data-placeholder");
      }
      close();
      wrapper.dispatchEvent(
        new CustomEvent("combobox:change", { detail: item.dataset.value }),
      );
    };
    // A declarative invoker prevents auto light-dismiss from closing the menu
    // before the same trigger's click tries to reopen it.
    trigger.setAttribute("popovertarget", popover.id);
    trigger.setAttribute("popovertargetaction", "toggle");
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen()) open();
      }
    });
    listboxFocus.addEventListener("keydown", (e) => {
      const items = getVisibleItems();
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          doHighlight(Math.min(highlighted + 1, items.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          doHighlight(Math.max(highlighted - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          doHighlight(0);
          break;
        case "End":
          e.preventDefault();
          doHighlight(items.length - 1);
          break;
        case "Enter":
          e.preventDefault();
          if (highlighted >= 0 && items[highlighted])
            selectItem(items[highlighted]);
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "Tab":
          close();
          break;
      }
    });
    listbox.addEventListener("click", (e) => {
      const item = e.target.closest('[role="option"]');
      if (item && !item.hidden && item.getAttribute("aria-disabled") !== "true")
        selectItem(item);
    });
    listbox.addEventListener("mousemove", (e) => {
      const item = e.target.closest('[role="option"]');
      if (item && !item.hidden) {
        const items = getVisibleItems();
        doHighlight(items.indexOf(item));
      }
    });
    popover.addEventListener("toggle", () => {
      const expanded = isOpen();
      trigger.setAttribute("aria-expanded", String(expanded));
      listboxFocus.setAttribute("aria-expanded", String(expanded));
      if (expanded) {
        position();
        listboxFocus.focus();
        const items = getVisibleItems();
        doHighlight(
          Math.max(
            0,
            items.findIndex((i) => i.getAttribute("aria-selected") === "true"),
          ),
        );
      } else {
        clearHighlight();
        listboxFocus.removeAttribute("aria-activedescendant");
      }
    });
    window.addEventListener("resize", () => {
      if (isOpen()) position();
    });
    window.addEventListener(
      "scroll",
      () => {
        if (isOpen()) position();
      },
      true,
    );
    return {
      setValue(value) {
        const item = allItems.find((i) => i.dataset.value === value);
        if (!item) return;
        allItems.forEach((i) =>
          i.setAttribute("aria-selected", String(i === item)),
        );
        valueEl.textContent = item.textContent.trim();
        valueEl.removeAttribute("data-placeholder");
      },
    };
  }
  window.ChroniclesCombobox = { init };
})();
