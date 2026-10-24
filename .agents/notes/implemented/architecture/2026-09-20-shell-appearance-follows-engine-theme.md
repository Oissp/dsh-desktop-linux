# Agent Note: Shell documents follow the engine appearance

Status: implemented

English | [中文](2026-09-20-shell-appearance-follows-engine-theme.zh.md)

## Problem

The shell owns documents the product does not render: the update prompt, the mandatory-update modal, and the policy-login placeholder. Their stylesheets hardcoded a light palette — `update-dialog.css` opened with `color-scheme: light` and literal `#fff`, `#0f1115`, and `#f5f5f5` — so they stayed white under 设置 → 通用设置 → 外观 while every product surface followed it. The product's own dialogs, such as the plugin manager's add-plugin modal, are themed through `--dsw-*` alias tokens and `body[data-ds-dark-theme]`, which is why the gap was visible in the same window: a themed page behind a white prompt.

The preference was already being read, but not for this. `DesktopAppearanceController` resolved `ui-theme.preference` from `settings.yaml` to swap window and tray icons on packaged Linux, and `preload-theme.ts` forwarded the product's theme source to `nativeTheme.themeSource` on macOS so sidebar vibrancy would follow the app. Neither reached a shell document, and neither ran on Windows.

## Decision

The stored preference becomes `nativeTheme.themeSource` on every platform. Electron documents that setting it makes `prefers-color-scheme` match in renderers, so the shell documents need no new channel: each one loads `shell-theme.js`, which reads `matchMedia('(prefers-color-scheme: dark)')`, toggles `body[data-ds-dark-theme]` to match, and does so again on every change. `themeSourceOf` maps only the built-in `light` and `dark` pair onto an overriding source; `system`, an absent preference, and any custom theme id all leave the OS in charge, which is the same rule `resolveAppearance` already applied to the icons.

`DesktopAppearanceController` now runs on every platform rather than inside the packaged-Linux block, and its callback does the icon work only there. It is started before the main window is created, so the Windows titlebar overlay colors and the Linux window icon are correct on the first paint instead of corrected afterwards. It tracks the appearance it last applied and skips a repeat, because writing `themeSource` emits `updated` and would otherwise apply twice per change.

Each shell document loads the client's `design-platform.css` from the built client's `lib/welcome` directory — served on the same `dsh-app://shell/` origin as the document, before its own stylesheet — and themes itself with the same `--dsw-alias-*` tokens and `body[data-ds-dark-theme]` attribute the product uses. The shell therefore resolves the palette from the product's token table rather than a copy: a palette change in `packages/client/ui-theme` reaches a prompt through the stylesheet both read, and the document needs no per-token duplication to stay in step.

The close glyph on the update prompt is a CSS mask — `background: currentColor; mask: url("update-close.svg")` — so it paints from whatever label color the surrounding theme sets. `update-close.svg` carries a fixed dark fill and is used only as a mask shape, never painted directly.

No shell document is a separate native window any more. The update prompt and the mandatory modal occupy a `WebContentsView` inside the product window, and the policy-login placeholder is framed in the product page, so a shell document's palette is always seen against the product surface it is composited over.

## Alternatives considered

**Publish the resolved appearance into each shell document over IPC.** Rejected: the shell would have to own the propagation for every document and every future document, where `themeSource` already reaches every renderer's `prefers-color-scheme`.

**Keep the controller Linux-only and extend the product window's theme-source IPC to all platforms.** Rejected: the shell's prompts can appear before the product window loads, so their colors would depend on a document that is not there yet.

**Use CSS system colors, as `policy-login-loading.html` does.** Rejected: `Canvas` and `CanvasText` follow the scheme but not the product palette, so a prompt would sit against the product window in a different gray. The login placeholder keeps them because it must render before any origin, font, or stylesheet is available.

**Keep the shell's own `--shell-*` token table instead of loading `design-platform.css`.** Rejected once the palette problem was solved: the table duplicated values the client stylesheet already ships, so every palette change upstream had to be re-copied by hand and a missed copy showed up as a prompt in the previous theme.

**Recolor the close icon by inlining the paths as `fill="currentColor"`.** Rejected: loading the shipped SVG as a mask keeps one definition of the glyph, and the colored background already gives it `currentColor` semantics without duplicating the path data in the document.

## Consequences

Light rendering is unchanged, because `design-platform.css` resolves the same values the shell stylesheets previously carried as literals. Dark rendering uses the product's dark palette, which means the primary button inverts to a near-white fill with dark text rather than staying dark. A user who selects a custom theme gets the OS appearance in shell documents, not that theme's palette, because a custom id names no shell equivalent — the same limit the icons have always had.

Shell documents now depend on the built client stylesheet being present at `lib/welcome/design-platform.css` and routed by the `shell` protocol branch, so the packaging step must ship it and a broken route leaves a prompt unstyled rather than merely off-palette.

`nativeTheme.themeSource` has two writers on macOS, this controller and the product window's IPC; they derive from the same stored preference, so they agree, but a change to one should consider the other.

Windows gains a behavior change beyond the prompt: context menus, DevTools, and the titlebar overlay follow the application appearance instead of the OS, because that is what setting `themeSource` does.

## Testing

`appearance.spec.ts` pins `themeSourceOf`'s mapping — including that a custom theme id and an absent preference both resolve to `system` — and that the controller writes the source, not only the callback value. `shell-theme.spec.ts` pins that each shell document loads `shell-theme.js`, applies the initial palette, follows a change, and stops listening on `pagehide`. `main-startup.spec.ts` pins that `dsh-app://shell/design-platform.css` is served from `lib/welcome` and `update-close.svg` as `image/svg+xml`.

No automated check compares rendered colors in dark mode; jsdom parses no CSS, so `update-error-renderer.spec.ts` can assert markup and attributes but not contrast. Confirming a prompt's colors on an installed build remains a manual step.

## Related

[The shell prompt note](../bug-fix/2026-09-19-linux-shell-prompt-opaque-card.md) covers the prompt documents' serving, in-window surface, and locale.
