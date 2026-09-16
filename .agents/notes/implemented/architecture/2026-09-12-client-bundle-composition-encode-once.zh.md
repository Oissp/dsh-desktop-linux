# Agent Note: Client bundle composition encodes each bundle once

Status: implemented

> 在组合路径上被 [同步上游 0.1.6-alpha.1](../process/2026-09-15-sync-upstream-0.1.6-alpha.1-adopt-asar-runtime-and-lazy-combo.zh.md) 部分取代：上游的延迟组合装配（`perf(web): defer client combo assembly`，`42286726c8`）提供了维护中的等价方案，故本 fork 的 encode-once 优化已退役。本 Note 作为调查记录保留，不再是 `buildCombo` 的现行权威。

[English](2026-09-12-client-bundle-composition-encode-once.md) | 中文

## 问题

桌面启动要等子 host 进程 2.8 秒，外壳才能导航到应用 URL。在本地开发 profile 上做归因（每次取样都用全新子进程，时钟停在 `{ type: 'ready' }` IPC 事件，不发起任何模型或网络请求）：2822 ms 的 boot 里有 2164 ms（77%）落在 `packages/client/modules` 的 `buildCombo` 内，也就是组合首屏要拉取的那批 client bundle 的地方。

代价来自在 11.5 MB client bundle 上重复的逐字节工作。`newlineCount` 为了算 indexed-map 的 section 偏移而逐码点遍历统计生成行数（self 451 ms）。每个 bundle 的文本在每次 combo 里被编码成 UTF-8 两次——一次为内容哈希，一次为追加 source-map 尾注（`utf8Write` 450 ms）。而 `compose()` 在三趟激活里每趟都从零构建每个插件的单条目 combo，把批次那趟已经准备好的 bundle 又解码、编码一遍。

先测的四个更廉价的假设全部被否决：runtime descriptor 解析加它那两次同一性哈希（2175 个文件共 1.7 ms）、挡在托盘与窗口创建之前被 await 的 `settings.yaml` 读取（0.25 ms）、`applyRelease` 对 286 个包的链接校验（9.4 ms），以及 `NODE_COMPILE_CACHE`（2738 → 2806 ms，无收益）。

## 决策

**每个 bundle 只在读入其字节时准备一次。** `WebPluginRecord` 用 `ComboSegment` 取代原始 bundle：已去掉调试指令并追加语句终止符、可直接拼接的字节，生成行数，回退用的生成文件名，以及——仅对不带授权 map 的 bundle——身份 map 的 `sourcesContent` 所需的终止符之前的文本。`comboSegment()` 在 record 构造时产出它，HMR 在 `rebuilt()` 接受新字节时再产出一次，于是同一 bundle 版本上的每个 combo 拼接的都是同一个 `Buffer`。

**`buildCombo` 拼接已准备的字节，而非字符串。** 它收集每个 segment 的字节，把它们的 `Buffer.concat` 与组合出的 source map 一起哈希，并把同一个数组交给 `comboScript`，由后者把 `sourceMappingURL` 尾注作为又一个 buffer 追加进去。combo 源码从不再被具化成 JavaScript 字符串，双重 UTF-8 编码由此消失。脚本字节与 rev 与原路径逐字节一致，已在本地 profile 的 58 个构建产物 client bundle（11,533,086 字节）上验证。

**用扫描而非逐码点统计换行。** `newlineCount` 通过 `indexOf('\n')` 推进。在真实语料体量上，同样的计数结果比逐码点遍历快 38.5×。

**身份 map 的 mappings 用重复拼出。** `identitySectionMap` 依据 segment 记录的行数拼出 `AAAA` 加 `';AACA'.repeat(lines - 1)`，不再分配数组再 join。该 map 描述的仍是终止符之前的 bundle，因此它的 `sourcesContent` 与 mappings 均未改变；只有不带 `client.js.map` 的 bundle 会走到这条路径。

**记住每行自己的单条目 combo。** record 的 `solo` 产物在首次使用时构建，并在 `rebuilt()` 中删除——那里被接受的字节会把每项输入整体替换。重新组合一张各行均未变化的图时，会复用这些产物而不再重建。

在同一套测量装置下，5 个全新子进程到 `ready` 的中位数：**2749 ms → 954 ms（2.88×）**。把构建产物里的循环改回去，2749 ms 即复现。

## 测试

`benchmarks/client-bundle-composition/` 为组合代价设闸：一个编译后的 worker 在合成语料（70 个可解析 client 包，每包 1,400 行生成代码，约 11.7 MB，每包都带授权 map）上挂载 `ClientModuleRegistry`，对从构造到首个被服务批次计时，并在 registry 仍可达的前提下报告保留堆。预算为 113 ms——`ciTimeBudget(45)`——另有一个校准用例把被接受的样本与被拒绝的回归中位数都固定为源码常量。

负控制直接跑这道闸：把逐码点换行循环与逐 record 重建放回构建产物，用例即以 143.3 ms 的中位数失败。语料由 `synthetic-client-packages.ts` 中经审阅的常量生成，不依赖任何录制 Session、环境仓库或用户材料。

行为由 `packages/client/modules/tests/loader.client.spec.ts` 与 `tests/node-half.client.spec.ts` 所有；后者的 indexed-map section 断言在过程中抓出了本次改动引入的唯一一处真实差异——语句终止符一度漏进了身份 map 的 `sourcesContent`。

## Alternatives considered

**跨 compose 趟次缓存批次产物。** 按 phase 与成员 id/rev 为批次产物做键、每趟只保留其用到的键，测得不带缓存 940 ms、带缓存 943 ms——三趟激活看到的批次成员确实不同，几乎无从复用。选择回退而非保留：那套失效推理并非免费，而它什么也没换来。

**给子 host 上 `NODE_COMPILE_CACHE`。** V8 代码缓存对准的是错的代价。boot 里 ESM 模块图加载只占 30–34 ms，而启用缓存测得 2738 → 2806 ms。

**把组合推迟到 `ready` 之后。** 渲染进程首屏就要拉取这些批次，把工作往后挪只是把等待挪进首帧，而非消除它。只能让组合本身变便宜。

**在 record 上保留原始 bundle，另存一份已准备字节做缓存。** 两者都留会让每个插件的保留字节翻倍。`record.bundle` 在 `comboSegment` 之外无人读取，因此替换该字段既是更小的改动，也是更小的占用。

**彻底去掉逐 record 的 combo。** 单条目 combo URL 在图中被公布，HMR 下会被单独改版的插件拉取；去掉它们会改变 registry 所服务的内容。记住它们则保持了被服务集合不变。

## 后果

冷启动到 `ready` 提前 1.8 秒，同一条组合路径也服务 Web profile 的首屏。client bundle 字节现在以已准备 segment 的形式存放在 record 上，因此日后想拿未经改动的产物的读者，须从 `meta.clientPath` 读取而非从 record 取。不带授权 source map 的 record 保留其解码文本；带 map 的不再保留，而后者是常见情形。

基准预算在 arm64 参考机上经共享 CI 时间尺度校准，是源码常量，无环境变量可覆盖。组合是被隔离测量的，因此它既不证明也不覆盖这些 bundle 的浏览器传输、绘制或滚动。

本次改动之后 boot 的剩余代价，按序为：`buildCombo` 逐 combo 的 source-map JSON 组装（self 约 125 ms）、对组合字节的 crypto `update`（约 46 ms），以及 Node 自身的模块编译（约 90 ms）。三者均未在此处理。
