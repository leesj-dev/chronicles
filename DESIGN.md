# Chronicles design

Inspired by the [Linear design analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) in [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md).

A product workspace, not a marketing page. Near-black canvas (`#010102`), charcoal panels (`#0f1011`, `#18191a`), hairline dividers (`#23252a`), light ink (`#f7f8f8`), and restrained lavender controls (`#828fff`). Use the documented system-font fallback instead of proprietary Linear fonts. Compact 4px spacing rhythm, 7px controls, 12px panels, 28px headings. The system appearance automatically selects the corresponding light or dark palette.

The chart is the signature: dates define columns, directly named models rank inside each chapter, circle **area** represents total usage, and common-scale bars show daily averages. A model label sits close to its circle. Never use a distant color legend as the only way to identify a model. Small shares read `<0.1%`.

Model colors encode identity, not UI chrome. Opus is purple, Sonnet orange, GPT sol and unsuffixed GPT models blue, terra yellow, luna green, astra red, Gemini teal, and Fable pink. Later versions use stronger shades in the same family. Both visualizations call the same deterministic color function. Model aliases merge across harnesses.

Harness badges toggle inclusion. Each badge toggles inclusion without a separate Only button. Select all becomes Deselect all when every harness is selected. Empty selection is valid and shows an empty result. Preserve labels, numeric values, keyboard focus, reduced motion, and readable controls at 390px. Long chapter comparisons scroll inside their chart, never the entire page.
