# DeepSeek Harness Desktop

English | [中文](README.zh.md)

The desktop application is an Electron shell around the dsh Web UI. It opens no listening port: the packaged Electron process boots the installed dsh project under `ELECTRON_RUN_AS_NODE`, versioned framed byte pipes carry Fetch requests and streaming responses without an outer Base64 envelope, Node IPC carries lifecycle control, and `dsh-app://` serves the matching client assets.

## Key technical decisions

| Decision | Why | Direct consequence |
|---|---|---|
| Release identity | The shell API, Web client, backend, and plugin graph are qualified as one combination; independent versions would create untested combinations and ambiguous update availability. | Electron and `@deepseek-ai/dsh` always have the same exact version. A dsh upgrade is a Desktop release, even when the shell code is unchanged. |
| Runtime | Electron's Node.js carries Electron patches, fuses, ABI, and lifecycle constraints, while system runtimes and package-manager state are uncontrolled. | dsh runs inside the packaged Electron process under `ELECTRON_RUN_AS_NODE`, while every package operation runs the bundled pnpm under the bundled upstream Node.js. System Node.js, system pnpm, and user package-manager configuration are outside the execution path. |
| Package sources | Core installation at startup adds work even when offline. | The release `app.asar` carries a complete production dependency tree (`dsh` inside the archive, native modules unpacked beside it); the profile installs only external plugins. |
| Shared modules | Host APIs can depend on module identity. | Desktop links every bundled first-party package into the profile using directory symlinks; ordinary plugin dependencies remain local. |
| State ownership | Sharing executable dependency graphs would let CLI and Desktop change each other's dsh, Cordis, plugin, or native-module versions, while two desktop processes could race on the same profile. | Electron acquires its process-lifetime single-instance lock before any profile access and exclusively owns `$DSH_HOME/profiles/desktop` plus its package-manager state. CLI and Desktop share supported product data under `$DSH_HOME`, but never executable packages, plugin activation, lockfiles, or `node_modules`. |
| Transport | A listening Web service adds port ownership, authentication, CORS, and exposure concerns; Electron's main process and its `ELECTRON_RUN_AS_NODE` backend child also need an explicit cross-process protocol. | The application opens no Web port. `dsh-app://` carries Web assets and Fetch traffic; framed byte pipes carry bounded request and response chunks with backpressure, while Node IPC carries only child lifecycle control. |
| Plugin changes | Package installation and Host startup can fail. | Desktop stops the Host and modifies the current profile directly. Failures retain partial changes for explicit repair; there is no automatic profile rollback. |
| Updates | Independent shell and dsh updates would recreate version splits, while unchanged shell blocks should not require a complete transfer. | The Electron shell, matching dsh runtime, Node.js, and pnpm form one update unit. Platform update artifacts may reuse unchanged blocks, but runtime version selection never splits from the Desktop release. |

## Installation ownership
Electron owns `$DSH_HOME/profiles/desktop`. Its `dependencies` contains only installed external plugins at exact versions; `dsh.profile.bundles` contains the built-in bundles followed by enabled plugins. The application supplies dsh, the private Desktop Host, and their production packages from the `dsh` tree packaged inside `app.asar`. Shared package links resolve into that packaged tree. Both host and plugins execute in the packaged Electron process under `ELECTRON_RUN_AS_NODE`, with normal realpath resolution; Desktop does not enable `--preserve-symlinks`. The CLI cannot boot or mutate this profile.

The local startup page exposes startup status and available recovery actions; the loaded dsh renderer receives only the desktop protocol marker. The separate plugin window receives structured list, install, remove, update, and update-check operations; neither renderer receives filesystem access, raw Electron IPC, a shell, or arbitrary pnpm arguments.

Electron chooses typed English or Chinese shell copy from its application locale and falls back to English. Menus, native dialogs, the startup page, and the plugin-management renderer use the same locale payload; the repository Client UI i18n gate checks these desktop sources.

### Runtime and plugin activation

The release `dsh/desktop-runtime.json` inside `app.asar` binds the shell version, bundled Node version, platform, architecture, shared package versions, and final file inventory. Startup reads the metadata and checks shared package records. Release schema, shell version, target compatibility, and file integrity are verified during packaging. Core packages are never copied into profile storage or installed by pnpm at first launch.

1. The main window displays a local loading page before profile preparation or backend startup. A fresh profile creates its manifest and shared package links while preserving unrelated files, then starts the actual backend once. Unchanged startups reuse the profile without scanning installed plugin manifests.
2. A compatible application upgrade refreshes shared links in the current profile and checks enabled plugins’ peer requirements. Plugin files, configuration, versions, and lockfile remain in place; pnpm does not run.
3. A changed bundled Node version, platform, or architecture reinstalls the locked plugin graph with scripts disabled, validates and links host packages, then runs approved pending builds and validates again.
4. Plugin add, update, and remove operations use bundled pnpm and Desktop-owned package-manager state. Reserved host packages must be peers; nested copies and aliases of shared packages fail validation. Ordinary plugin dependencies must resolve inside the profile.
5. Plugin changes stop the backend before modifying the current profile. Successful preparation starts the Host. Package or Host startup failures retain modified files and report the error. Unfinished package operations retain a marker so the next launch retries the locked installation and pending builds. Desktop creates no staging directories, activation journals, or rollback copies.

The loading page does not depend on the Host. Errors offer restart and reinstallation guidance. Disabling plugins and resetting Desktop are offered only when packaged application resources support profile recovery; development and early initialization failures expose restart alone. The plugin manager remains available through the application menu. Runtime identity is checked before any backend starts; plugin changes have no automatic rollback.

Reset deletes every entry in `$DSH_HOME/profiles/desktop` except the held transaction lock, then initializes the built-in profile. It removes Desktop configuration and installed third-party packages without a backup. Shared tasks, settings, and the Harness-home `.env` are untouched. Shell resource and preload failures use a self-contained document with the available recovery actions and diagnostics; its controls do not require preload.

Package transactions hold `$DSH_HOME/profiles/desktop/lock` exclusively through pnpm process exit. Reset preserves the directory and its lock until initialization and Host startup finish. Shared links use directory symlinks; cleanup removes links without deleting their targets. Native builds follow the profile’s reviewed `allowBuilds` list; installing a new build-requiring package without approval in that list fails the transaction.

## Develop

`dev:desktop` builds the current Host, client bundles, Web frontend, and Electron shell, projects the built CLI and private Desktop Host packages with their workspace dependencies into a disposable desktop npm project, and launches Electron without downloading the packaged Node.js runtime or resolving dsh from npm:

```sh
pnpm run dev:desktop
```

Development Harness state defaults to `apps/desktop/.desktop-build/development/home`, the disposable npm project lives at `apps/desktop/.desktop-build/development/project`, and Electron browser data lives at `apps/desktop/.desktop-build/development/electron-user-data`. Sessions, settings, credentials, package links, and browser data therefore stay out of the user's normal Harness home. An explicit `DSH_HOME` replaces only the development Harness home. Renderer DevTools opens automatically; Main, Renderer, and dsh Host debugging listen on ports 9229, 9222, and 9230. `DSH_DESKTOP_MAIN_INSPECT_PORT`, `DSH_DESKTOP_RENDERER_DEBUG_PORT`, and `DSH_DESKTOP_HOST_INSPECT_PORT` replace those ports, while `DSH_DESKTOP_OPEN_DEVTOOLS=0` keeps the detached Renderer tools closed.

After an explicit build, `start:desktop` reconstructs the disposable project and launches the existing artifacts without building again:

```sh
pnpm run start:desktop
```

Workspace development runs the current CLI and private Desktop Host packages under the invoking Node.js and disables desktop package mutations. Its explicitly linked disposable profile is the only mode allowed to resolve bundles outside its own directory. Use an unpacked application to exercise the bundled Node.js, bundled pnpm, bundled dsh resources, plugin installation and repair paths.

## Package

The normal packaging path is one complete command. It performs release preparation before creating the Linux installers and update metadata. The target requires a reverse-DNS `DSH_DESKTOP_APP_ID`:

```sh
export DSH_DESKTOP_APP_ID='<reverse-DNS application ID>'
```

`prepare:desktop` is not a prerequisite:

```sh
pnpm run package:desktop
```

Release automation uses the fixed target command so runtime preparation, dsh preparation, and electron-builder receive the same platform and architecture:

```sh
pnpm run package:desktop:linux:x64
```

The command requires Linux x64 and builds a `.deb` installer plus an AppImage; the AppImage is the electron-updater payload because Debian packages cannot carry differential updates.

Each target owns its packed package inputs, prepared runtime, package set, dsh tree, pnpm preparation state, unpacked application, update metadata, and final artifacts under `apps/desktop/.desktop-build/targets/<target>/`. The Node.js archive cache remains shared under `.desktop-build/downloads` because every archive name includes its version, platform, and architecture and is verified before extraction. A target build never consumes another target's mutable preparation state.

### Runtime file selection

Production packages first pass through npm's publication rules and dependency installation. [Desktop's file policy](scripts/runtime-file-policy.ts) then filters the immutable packaged `dsh/node_modules` copy before integrity sealing. It omits TypeScript declarations, recognized JavaScript/CSS/TypeScript source maps, TypeScript build caches, Domino's test directory, selected native compiler outputs, and node-pty prebuilds for other platforms. It preserves runtime JavaScript, native modules and their DLL/EXE helpers, WASM, unknown assets, licenses, and notices. The policy does not alter npm tarballs, the bundled package manager, or user-installed plugin files.

The packaged application runs compiled JavaScript and pre-generated Typert metadata; it does not compile TypeScript plugins. Source-level debugger navigation and editor declarations remain available in development packages. [Copy-policy tests](tests/runtime-file-policy.spec.ts) cover exclusions and retained assets; `prepare:dsh` runs the [payload smoke](tests/fixtures/runtime-payload-smoke.mjs) under the bundled Node, then loads the bundled native require-builtin loader under the packaged Electron ([fingerprint smoke](tests/fixtures/native-electron-fingerprint-smoke.mjs)), before the Host smoke and final inventory verification.

### Update distribution

Packaging writes an `app-update.yml` whose `provider: github` entry points at the separate release repository `Oissp/dsh-desktop-linux-release`, and passes `--publish never` so electron-builder uploads nothing itself. [The release workflow](../../.github/workflows/package-deb.yml) creates the `v<version>` GitHub Release from that repository's artifacts: the `.deb`, the AppImage, and the `latest-linux.yml` channel metadata.

The AppImage is the electron-updater payload because Debian packages cannot carry differential updates. electron-updater derives the release to follow from the prerelease segment of the installed version, so a `0.1.6-alpha.2.1` installation tracks `alpha` releases. Updates are read anonymously from the public release repository, so packaging and release need neither upload credentials nor a deployment environment.

Create a runnable application directory instead of an installer by using the matching `:dir` command, such as:

```sh
pnpm run package:desktop:dir
pnpm run package:desktop:linux:x64:dir
```

To inspect or troubleshoot the prepared host-target resources without invoking electron-builder, stop the same pipeline after preparation:

```sh
pnpm run prepare:desktop
```

This diagnostic command is an alternative stopping point, not the first half of a two-command build. A later `package:desktop*` command repeats the official build and preparation so it cannot consume stale dsh packages, runtime files, or dsh content.

Every package command builds the repository, packs the first-party production closures rooted at dsh and the private Desktop Host, and prepares target-specific Node and pnpm executables. `prepare:dsh` installs the production graph once at build time, copies materialized packages into the `dsh` tree that electron-builder packs into `app.asar`, removes package-manager metadata, and writes `desktop-runtime.json` with shared package versions and final file hashes. Before integrity sealing, the [Electron fingerprint reconciler](scripts/native-electron-fingerprint.ts) rewrites the bundled native require-builtin loader's recorded Electron profile — Node.js version triple plus V8 version string, matched exactly by the loader — to the packaged Electron's identity, because Electron patch builds move those within one major; it then loads the loader under the packaged Electron as a packaging acceptance gate. Resource mappings explicitly include `dsh/node_modules`, which the default root-directory filter omits; the copied inventory is verified once immediately after the copy and again after the runtime smokes, both before electron-builder runs. Installed upgrade and target-specific native-module qualification require the release environment.

An unpacked artifact contains the Electron shell with the materialized dsh production tree packed inside `app.asar`, plus upstream Node.js and pnpm. Installer size and filesystem size differ; release qualification measures both, plus the profile’s plugin storage and first-launch latency. The runtime trades more application files for eliminating core package installation on the user’s machine.

## Updates

A packaged application checks its target-specific release stream ten seconds after the main window opens; the localized **Check for Updates…** menu item triggers the same check manually. An available release opens one native confirmation dialog. Accepting it waits for an in-flight check, downloads and verifies the Desktop release, stops the dsh child, and hands installation plus restart to electron-updater. The next launch displays the local loading page while reconciling the version-bound runtime.

Packaging emits generic-provider channel metadata for the deployment selected by `DSH_DESKTOP_AUTO_UPDATE_ENV`. The AppImage target embeds its blockmap so electron-updater can reuse unchanged blocks; the `.deb` installer is not an updater payload. The runtime and shell still form one Desktop release.

## Low-level development overrides

An unpackaged Electron process uses `.desktop-build/development/project` under its application directory as its development project. `DSH_DESKTOP_NODE_BINARY`, `DSH_DESKTOP_PNPM_ENTRY`, and `DSH_DESKTOP_DSH_DIR` select explicit runtime resources. Packaged applications ignore these variables, resolve resources from `process.resourcesPath`, and use the managed Desktop profile.

## Known limitations

- The Web "Open In..." action is disabled in Desktop because its host plugin requires HTTP routes; Desktop does not provide a `webServer`.
- Release update hosting and previous-version installed-artifact qualification require the production release environment.
- Desktop plugins with dependency lifecycle scripts are rejected unless their package appears in the desktop project's reviewed `allowBuilds` policy.
- The desktop shell shares sessions, settings, credentials, workspaces, and storage under `$DSH_HOME` with CLI dsh, while executable packages, plugin activation, lockfiles, and package-manager state remain separate.
