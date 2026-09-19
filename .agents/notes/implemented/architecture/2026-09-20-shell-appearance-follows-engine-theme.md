# Agent Note: Shell documents follow the engine appearance

Status: implemented

English | [中文](2026-09-20-shell-appearance-follows-engine-theme.zh.md)

## Problem

The shell owns documents the product does not render: the update prompt, the mandatory-update modal, and the policy-login placeholder. Their stylesheets hardcoded a light palette — `update-dialog.css` opened with `color-scheme: light` and literal `#fff`, `#0f1115`, and `#f5f5f5` — so they stayed white under 设置 → 通用设置 → 外观 while every product surface followed it. The product's own dialogs, such as the plugin manager's add-plugin modal, are themed through `--dsw-*` alias tokens and `body[data-ds-dark-theme]`, which is why the gap was visible in the same window: a themed page behind a white prompt.

The preference was already being read, but not for this. `DesktopAppearanceController` resolved `ui-theme.preference` from `settings.yaml` to swap window and tray icons on packaged Linux, and `preload-theme.ts` forwarded the product's theme source to `nativeTheme.themeSource` on macOS so sidebar vibrancy would follow the app. Neither reached a shell document, and neither ran on Windows.

## Decision

The stored preference becomes `nativeTheme.themeSource` on every platform. Electron documents that setting it makes `prefers-color-scheme` match in renderers, and that applications should read `shouldUseDarkColors` to decide what to apply, so the shell documents need no new channel: they declare `color-scheme: light dark` and carry a dark block behind `@media (prefers-color-scheme: dark)`. `themeSourceOf` maps only the built-in `light` and `dark` pair onto an overriding source; `system`, an absent preference, and any custom theme id all leave the OS in charge, which is the same rule `resolveAppearance` already applied to the icons.

`DesktopAppearanceController` now runs on every platform rather than inside the packaged-Linux block, and its callback does the icon work only there. It is started before the main window is created, so the Windows titlebar overlay colors and the Linux window icon are correct on the first paint instead of corrected afterwards. It tracks the appearance it last applied and skips a repeat, because writing `themeSource` emits `updated` and would otherwise apply twice per change.

Each shell document repaints from its own copy of the values the product's alias tokens resolve to, because the client palette is installed into the product document's `body` and a shell document is a separate document. The light values are the literals that were already there — they match `bg-layer-1`, `label-primary`, `button-primary-fill`, and `button-elevated-fill` exactly — and the dark block takes those same tokens from `body[data-ds-dark-theme]` in `design-platform.css`.

Opaque prompt windows are prepainted in the resolved surface color, because the document's own paint lands after the window is shown and a mismatched `backgroundColor` flashes. The close glyph is inlined as `fill="currentColor"` rather than loaded as an `<img>`: the asset carried a fixed dark fill that a dark card would have hidden.

## Alternatives considered

**Publish the resolved appearance into each shell document over IPC, as `surface` already is.** Rejected: the shell would have to own the propagation for every document and every future document, where `themeSource` already reaches every renderer's `prefers-color-scheme`.

**Keep the controller Linux-only and extend the product window's theme-source IPC to all platforms.** Rejected: the shell's prompts can appear before the product window loads, so their colors would depend on a document that is not there yet.

**Use CSS system colors, as `policy-login-loading.html` does.** Rejected: `Canvas` and `CanvasText` follow the scheme but not the product palette, so a prompt would sit against the product window in a different gray. The login placeholder keeps them because it must render before any origin, font, or stylesheet is available.

**Import the client's `--dsw-*` stylesheet into the shell documents.** Rejected: the client installs those sheets from its own bundle at runtime, and the shell needs a handful of values rather than the whole palette.

**Recolor the close icon with a CSS mask.** Rejected: inlining the two paths keeps the glyph in one place and needs no prefix, no extra CSP allowance for a mask resource, and no change to the button markup.

## Consequences

Light rendering is unchanged, because the light token values are the literals that were already in the stylesheets. Dark rendering uses the product's dark palette, which means the primary button inverts to a near-white fill with dark text rather than staying dark. A user who selects a custom theme gets the OS appearance in shell documents, not that theme's palette, because a custom id names no shell equivalent — the same limit the icons have always had.

Two facts now live in two places. The shell's token values duplicate what `design-platform.css` resolves, so a palette change upstream will not reach them; the dark values in `update-dialog.css` name their source token in a comment for that reason. And `nativeTheme.themeSource` has two writers on macOS, this controller and the product window's IPC; they derive from the same stored preference, so they agree, but a change to one should consider the other.

Windows gains a behavior change beyond the prompt: context menus, DevTools, and the titlebar overlay follow the application appearance instead of the OS, because that is what setting `themeSource` does.

## Testing

`appearance.spec.ts` pins `themeSourceOf`'s mapping — including that a custom theme id and an absent preference both resolve to `system` — and that the controller writes the source, not only the callback value. `update-overlay.spec.ts` pins the prepaint color in both themes for the card and the mandatory window. `update-error-renderer.spec.ts` pins that the close glyph paints from `currentColor`, which fails if it reverts to an `<img>`.

No automated check renders a shell document in dark mode, because jsdom applies no `prefers-color-scheme` and the CSS is not parsed for contrast. Confirming a prompt's colors on an installed build remains a manual step.

## Related

[The shell prompt note](../bug-fix/2026-09-19-linux-shell-prompt-opaque-card.md) covers the prompt documents' serving, surface, sizing, and locale.
