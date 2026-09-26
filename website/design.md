# Website design tokens

This file records the color, type, and radius tokens the website uses. `website/tokens.css` holds the source values. `app/globals.css` imports that file and maps old component variables to these values.

## Source files

- `website/tokens.css` holds the light values in `:root`, the dark values in `.dark`, and the Tailwind mapping in `@theme inline`.
- `app/globals.css` imports `../tokens.css`. New code reads the token names directly. Old selectors keep working through compat variables defined in `globals.css`.
- `app/layout.tsx` sets `themeColor` to `#ffffff` to match `--background`.

## Core tokens

Light mode uses a white background with blue primary actions.

- `--background: #ffffff`. Page background.
- `--foreground: #333333`. Body text.
- `--card: #ffffff`. Cards and dialog surfaces.
- `--card-foreground: #333333`. Text on cards.
- `--popover: #ffffff`. Popover background.
- `--popover-foreground: #333333`. Text in popovers.
- `--primary: #3b82f6`. Main actions and links.
- `--primary-foreground: #ffffff`. Text on primary actions.
- `--secondary: #f3f4f6`. Quiet fills.
- `--secondary-foreground: #4b5563`. Text on secondary fills. The site also uses this value for muted text because it passes contrast on blue tints.
- `--muted: #f9fafb`. Subtle fills.
- `--muted-foreground: #6b7280`. Muted text on white and gray only. Do not place it on `--accent`.
- `--accent: #e0f2fe`. Highlight fills.
- `--accent-foreground: #1e3a8a`. Text on accent fills.
- `--border: #e5e7eb`. Borders and inputs share this value through `--input`.
- `--input: #e5e7eb`. Input borders.
- `--ring: #3b82f6`. Focus rings.
- `--destructive: #ef4444`. Destructive actions.
- `--destructive-foreground: #ffffff`. Text on destructive actions.
- `--radius: 0.375rem`. Base radius. New components start here.

Dark mode inverts the surfaces and keeps the same blue primary.

- `--background: #171717`
- `--foreground: #e5e5e5`
- `--card: #262626`
- `--secondary: #262626`
- `--muted: #1f1f1f`
- `--accent: #1e3a8a`
- `--accent-foreground: #bfdbfe`
- `--border: #404040`
- `--input: #404040`
- `--sidebar: #171717`

Sidebar tokens follow the same pair of modes. Light sidebar uses `#f9fafb` with `#333333` text and `#e0f2fe` accents. Dark sidebar uses `#171717` with `#e5e5e5` text and `#1e3a8a` accents.

## Chart tokens

Charts use a blue ramp. Use them in order.

- Light: `#3b82f6`, `#2563eb`, `#1d4ed8`, `#1e40af`, `#1e3a8a`
- Dark: `#60a5fa`, `#3b82f6`, `#2563eb`, `#1d4ed8`, `#1e40af`

## Type tokens

- `--font-sans: Inter, sans-serif`. Body and headings.
- `--font-mono: JetBrains Mono, monospace`. Labels, metadata, code, and keys.
- `--font-serif: Source Serif 4, serif`. Long editorial passages when a serif fits. Body defaults to sans.

The Geist `@font-face` blocks are gone from `globals.css`. The font files still sit under `public/fonts` and nothing references them. Load Inter and JetBrains Mono with `next/font` and delete the unused Geist files. Until then the stack falls back to system sans and mono.

## Compat mapping in globals.css

Old selectors reference names like `--ink` and `--purple-deep`. `globals.css` keeps those names and points each one at a hex from the token set. Tests read these hex values, so the mapping uses literal hex values and not `var()` refs.

- `--canvas: #ffffff` matches `--background`
- `--surface: #ffffff` matches `--card`
- `--surface-soft: #f3f4f6` matches `--secondary`
- `--cream: #f9fafb` matches `--muted`
- `--paper-deep: #f9fafb` matches `--muted`
- `--ink: #333333` matches `--foreground`
- `--ink-soft: #4b5563` matches `--secondary-foreground`
- Text that used the old `--muted` now uses `--secondary-foreground: #4b5563`. `--muted` keeps its token meaning as a fill (`#f9fafb` light, `#1f1f1f` dark).
- `--purple: #3b82f6` matches `--primary`
- `--purple-deep: #1d4ed8` matches `--chart-3`
- `--blue: #2563eb` matches `--chart-2`
- `--coral: #2563eb` matches `--chart-2`
- `--lavender: #e0f2fe` matches `--accent`
- `--lavender-soft: #e0f2fe` matches `--accent`
- `--coral-soft: #e0f2fe` matches `--accent`
- `--line: #e5e7eb` matches `--border`
- `--line-strong: #e5e7eb` matches `--border`
- `--focus-ring: #3b82f6` matches `--ring`
- `--trust-surface: #171717` matches dark `--background`
- `--trust-muted: #a3a3a3` matches dark `--muted-foreground`

Dark overrides under `.dark` flip the compat names to the dark hex values. The privacy section keeps a dark fill in both modes.

Radius now derives from the base token.

- `--radius-xl: 0.75rem`
- `--radius-lg: 0.5rem`
- `--radius-md: 0.375rem`

These replace the old 30px, 22px, and 16px values. Layout spacing did not change.

## Contrast results

The style tests check these pairs. Numbers come from WCAG relative luminance.

- `#4b5563` on `#ffffff` gives 7.56. Pass.
- `#4b5563` on `#f9fafb` gives 7.23. Pass.
- `#4b5563` on `#e0f2fe` gives 6.59. Pass.
- `#1d4ed8` on `#f9fafb` gives 6.41. Pass.
- `#ffffff` on `#1d4ed8` gives 6.7. Pass.
- `#333333` on `#bfdbfe` gives 8.89. Pass. This is the `mark` highlight. It used `#ffc4b6` before. It now uses the light blue tint.
- `#a3a3a3` on `#171717` gives 7.11. Pass.
- `#ffffff` on `#171717` gives 17.93. Pass.

Do not use `#6b7280` on `#e0f2fe`. That pair gives 4.21 and fails AA. Use `#4b5563` for text on blue tints.

Form errors keep `#a43b32` for text because it gives 6.46 on white. `--destructive` (`#ef4444`) gives 3.76 on white and fails as text. The no-answer card uses `var(--destructive)` for its dashed border and `#f9fafb` for its fill. Window dots use the chart blues (`#3b82f6`, `#60a5fa`, `#2563eb`). Favicon and OG art use `#1d4ed8` for marks and `#e0f2fe` for fills.

## Rules for new code

- Read colors from the token names. Use `var(--primary)` for actions, `var(--accent)` for highlight fills, `var(--border)` for lines, `var(--background)` and `var(--foreground)` for page text.
- Use `var(--font-mono)` for labels under 0.78rem, metadata, buttons in demo rows, and keyboard hints. Use `var(--font-sans)` for everything else.
- Start new components at `var(--radius)`. Step up to `--radius-lg` only for large cards.
- Add `.dark` styles when you add a light style that sets a background or text color. The site toggles dark mode with the `dark` class on `html`.
- Keep selectors flat and keep state styles next to the base rule. The demo controls, privacy panel, and FAQ list follow this order.
