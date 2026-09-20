# Agent Note: Desktop startup tests pin the simulated Windows architecture

Status: implemented

[English](2026-09-20-desktop-startup-test-windows-arch.md) | 中文

## 问题

`apps/desktop/tests/main-startup.spec.ts` 模拟打包后的 Windows 客户端：它的 `beforeEach` 把全局 `process` stub 成 `{ ...process, platform: 'win32', resourcesPath: 'desktop-test-resources' }`。展开会带上宿主机的架构，于是在 arm64 机器上 stub 同时产出 `platform: 'win32'` 和 `arch: 'arm64'`。

`apps/desktop/src/main.ts` 把这一对直接复制进强制更新策略的身份，而 `DesktopMandatoryUpdatePolicy` 只接受 `desktop-win` 配 `x64`——Windows 客户端只发 x64。构造函数抛出 `desktop policy: invalid installed client identity`，启动流程把它当成致命错误，于是弹出恢复窗口，而不是用例等待的策略对话框。

15 个用例失败：1 个断在对话框断言上，14 个超时，因为启动中断后测试等待的 promise 永远不会 resolve。只有启用了策略配置的用例才会走到身份构造，文件里其余用例因此照常通过。GitHub 的 `ubuntu-24.04` runner 是 x64，CI 从来不会造出这个被拒绝的组合。

## 决策

`beforeEach` 的 stub 显式写出它模拟的架构：`{ ...process, platform: 'win32', arch: 'x64', resourcesPath: 'desktop-test-resources' }`。同文件里 About 面板的 `it.each` 展开的是已被 stub 的 `process`，因此继承 `arch: 'x64'`，不需要单独钉住。

`apps/desktop/tests/mandatory-update-policy.spec.ts` 记录测试所依赖的构造规则：`desktop-win` 配 `arm64`、非 semver 的 `version`、空的 `bundledDshVersion`、只有空白的 `bundleId` 都抛 `invalid installed client identity`，而 `desktop-mac` 配 `arm64` 可以构造出策略实例。

## 考虑过的替代方案

**在策略身份里接受 Windows arm64。** 这条校验编码的是「不存在 arm64 的 Windows 客户端」这一事实，而上报的 `x-client-platform`/`x-client-arch` 正是策略后端用来匹配的字段。要接受这个组合，得先发布那个客户端。

**只 stub 每个用例读到的 `process` 字段。** 启动路径碰到的每个字段都得逐一列举，之后新增的读取会悄悄拿到宿主值——同一个故障，而且更难追。钉住唯一不能随宿主机变化的字段，可以保留展开和它的默认值。

**在非 x64 宿主上跳过受影响的用例。** 这只是把故障从开发者机器上藏起来，而不是让模拟变得确定；套件会在 Apple Silicon 上悄悄少跑 15 个用例。

## 影响

套件不再依赖宿主架构，这些用例在 arm64 开发机和 x64 CI 上表现一致。

所有用例模拟的都是 Windows x64 客户端，因此没有任何用例走 Windows arm64 身份；新加的策略用例把那个组合记录为被拒绝，而不是当作客户端来跑。

这是 fork 与上游的差异：上游 `deepseek-harness` 里仍是未钉住的 stub。合并时若采纳上游的 `apps/desktop/tests/main-startup.spec.ts`，arm64 上的失败会复现，必须重新补上 `arch: 'x64'`。

## 测试

在 arm64 宿主上 `pnpm exec vitest run apps/desktop/tests/main-startup.spec.ts apps/desktop/tests/mandatory-update-policy.spec.ts` 通过 96 个用例。只回退那一行钉住，其中 15 个就会失败。
