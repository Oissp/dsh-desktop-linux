# Agent Note: 打包期改写桌面端原生加载器的 Electron 指纹

Status: implemented

[English](2026-09-16-desktop-native-loader-electron-fingerprint-patch.md) | 中文

## 问题

本 fork 自行打包 Linux 桌面安装包（`.deb` + AppImage），并且为保留 Electron 44.3.0 升级的托盘修复而把 Electron 钉得比上游新（44.0.0 → 44.3.0）。打包运行时内置了 `node-addon-require-builtin`，其编译产物只在运行中的 Node.js 版本三元组和 V8 版本字符串与其记录的某条 Electron profile 完全相等时才放行——43.0.0 → Node 24.17.0 / V8 15.0.245.13-electron.0，44.0.0 → Node 24.18.1 / V8 15.2.124.13-electron.0，45.0.0-alpha.6 → Node 24.21.0 / V8 15.4.80-electron.0。Electron 44.2.0 把 Node.js 升到 24.20.0 并回移了 V8 修复（15.2.124.19-electron.0），于是 fork 包内每次加载该加载器都在启动时失败：

```
dsh desktop: host preparation failed: node-addon-require-builtin unsupported: Unsupported/no-context
(unsupported Electron runtime fingerprint: Node 24.20.0, V8 15.2.124.19-electron.0
(supported Electron versions: 43.0.0, 44.0.0, 45.0.0-alpha.6))
```

上游发布不受影响，因为上游钉住 `electron@44.0.0`，加载器记录了它的指纹。该 addon 的原生源码不公开（二进制里只带有 `/workspace/packages/native` 构建路径），而已发布的最新版本 0.1.6 仍然没有 44.2+ 的 profile。fork 的 0.1.6-alpha.1 包完全无法启动。

## 决策

在 `prepare:dsh` 期间、完整性封存之前，把内置加载器的 Electron profile 表与打包的 Electron 构建调和一致：[scripts/native-electron-fingerprint.ts](../../../../apps/desktop/scripts/native-electron-fingerprint.ts) 在 `ELECTRON_RUN_AS_NODE` 下探测打包的 Electron 二进制得到 `{electron, node, v8}` 标识，定位同一 Electron 大版本的 profile 记录，就地改写该记录的 Node.js 版本三元组和 V8 版本字符串，然后在打包的 Electron 下实际加载该加载器，作为打包验收门槛——必须能解析 dsh profile resolver 需要的全部内置模块。该门槛通过之前不允许打包发布。

代码本身无法承载的二进制事实：

- 加载器仅按「Node.js 三元组精确相等 + V8 字符串精确相等」选择 profile。记录中的 Electron 版本文本只用于诊断，而独立的 `electron-<major>` tag 选择 embedder-data ABI，必须继续描述打包的大版本，因此两者都不改写。
- 只改字符串经真实二进制实测并不充分：改写记录的 V8 字符串（甚至 Electron 版本文本）后仍然失败，因为 Node.js 三元组同样参与精确比较。
- 记录是固定步长的 `{长度, 指针}` 字符串引用，所以就地改写要求替换的 V8 文本字节长度相同；长度不一致时构建失败，而不是破坏整张表。
- 调和器对每一个未满足的前置条件都大声失败：运行时树下没有预构建二进制、无法识别 profile 表、没有打包大版本的记录、验证阶段加载被拒。打包中止，而不是发布一个启动即坏的包。
- 加载器自身的物化缓存会用源文件的 SHA-256 校验缓存副本，不一致时回退到源目录，因此改写后的二进制不会被陈旧缓存遮蔽。
- 打包引擎缓存键对所有已跟踪源文件（包括本调和器）做哈希，因此调和器的任何改动都会触发完整的重新准备。

退役条件：当上游发布的 `node-addon-require-builtin` 已记录打包 Electron 的指纹时，调和器对该构建自动成为空操作（已匹配的记录不会被改动）；一旦没有打包 Electron 仍需要改写，就应将其退役。

## Consequences

fork 保留了 Electron 44.3.0 及其托盘修复，打包也能在加载器从未记录过的 Electron 构建上启动。代价是维护者承担了对私有二进制记录布局的依赖：改变 profile 表结构的 addon 更新会让打包大声失败，而不是在用户启动时才失败；一旦没有打包 Electron 仍需要改写，就必须退役该调和器。等长的 V8 约束也收窄了 Electron 可发布的范围——未来加长 V8 字符串的回移会让打包失败，直到调和器学会重建字符串区域。

## 已考虑的替代方案

- **像上游一样钉住 Electron 44.0.0。** 拒绝：这会丢弃促成升级的 GNOME/Wayland 托盘回归修复和 Flatpak/Snap 托盘图标修复，并让 fork 落后于上游壳所需的 Electron 补丁线。
- **等待上游发布新版 addon。** 拒绝作为唯一方案：原生源码不公开，当时没有任何版本加入该 profile，桌面端在此期间无法使用。
- **让 dsh host 改用内置的上游 Node.js 运行时而非 `ELECTRON_RUN_AS_NODE` 运行。** 拒绝：壳把宿主进程绑定在它自带的 Electron 二进制上；引入第二套运行时会成倍扩大发布管线负责的验收面，而一次数据改写已经解决了问题。
