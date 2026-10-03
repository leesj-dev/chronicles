# Chronicles design

Controls use the semantic tokens and native HTML components from [codylindley/shadcn-html](https://github.com/codylindley/shadcn-html). The local `web/shadcn.css` includes pinned button, toggle, select and checkbox styles; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Nova density is translated from [shadcn/ui style-nova.css](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/styles/style-nova.css): 32px default buttons/inputs/selects, 28px small harness toggles, 8px control corners and quiet borders. No framework, build step, font download or CDN is needed. Dark tokens follow `prefers-color-scheme` automatically.

Neutral surfaces, quiet borders, consistent control heights and clear spacing put the charts first. Harness selection uses a solid primary fill. Model selection uses a secondary fill. Selection never creates a focus ring; keyboard focus alone uses `:focus-visible`. The tab strip uses a raised active surface. Select menus are custom shadcn-html popovers/listboxes, with Arrow keys, Home/End, Enter, Escape, Tab and type-ahead. No native select menu is rendered. The original layout direction referenced [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md); the control system now follows shadcn-html.

The chart is the signature: dates define columns, directly named models rank inside each chapter, circle **area** represents total usage, and common-scale bars show daily averages. A model label sits close to its circle. Never use a distant color legend as the only way to identify a model. Small shares read `<0.1%`.

Model colors encode identity, not UI chrome. Opus is purple, Sonnet orange, GPT sol and unsuffixed GPT models blue, terra yellow, luna green, astra red, Gemini teal, and Fable pink. Later versions use stronger shades in the same family. Both visualizations call the same deterministic color function. Model aliases merge across harnesses.

Harness badges toggle inclusion. Each badge toggles inclusion without a separate Only button. Select all becomes Deselect all when every harness is selected. Empty selection is valid and shows an empty result. Preserve labels, numeric values, keyboard focus, reduced motion, and readable controls at 390px. Long chapter comparisons scroll inside their chart, never the entire page.

Chapter headers use their intrinsic content height, then share the tallest measured height across all columns. Wrapping harness badges must never overlap model labels. Sources is hidden in demo, and empty account metrics are omitted.
