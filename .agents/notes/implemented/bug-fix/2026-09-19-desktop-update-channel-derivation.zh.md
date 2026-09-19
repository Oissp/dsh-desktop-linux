# Agent Note: Desktop update channel derives from the installed version

Status: implemented

[English](2026-09-19-desktop-update-channel-derivation.md) | 中文

## Problem

[0.1.6-alpha.2 合并](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.zh.md)在 `update-coordinator.ts` 里钉住 `updater.channel = 'latest'`，理由是 GitHub provider 必须请求 `latest-linux.yml` 而不是上游的 `nightly-linux.yml`。这个读法把 electron-updater 的优先级弄反了。`GitHubProvider` 把 `updater.channel` 当作已安装客户端自己的频道，用它过滤 release feed，其优先级高于已安装版本的预发布段。当 `channel === 'latest'` 时，对 tag `v0.1.6-alpha.2.1` 而言两个准入判断都不成立：`shouldFetchVersion` 只接受频道缺省或 `alpha`/`beta`，`isNextPreRelease` 要求 tag 的预发布段等于频道。tag 保持 `null`，每次检查都抛 `ERR_UPDATER_NO_PUBLISHED_VERSIONS`，因此任何已安装版本都发现不了更新。

## Decision

`DesktopUpdateCoordinator` 不再设置 `updater.channel`。electron-updater 于是从 `semver.prerelease(currentVersion)[0]` 推导频道——本 fork 发布的版本都得到 `alpha`——再拿它与 release feed 的 tag 匹配。频道元数据文件名由解析出的 tag 决定：客户端先请求 `alpha-linux.yml`，该文件不存在时回落到 `latest-linux.yml`，也就是 electron-builder 默认 `github` 频道真正发布的那个文件。

频道只由已安装版本决定。打包和发版工作流都不选择频道，因此版本从 `alpha` 走到 `beta` 再到稳定版时，跟随的频道随之改变，无需改配置。

## Alternatives considered

**在 `latest-linux.yml` 之外再发布 `alpha-linux.yml`。** 否决：这份副本必须按预发布标识逐个改名，等于把频道名写进发版工作流的资产列表，而回退路径本来就能成功，用户看不到任何差别。它还会消掉该回退路径唯一的端到端演练。

**保留 `channel = 'latest'` 并把 `allowPrerelease` 设为 `false`。** 否决：发布仓库只有预发布版本，稳定频道查询解析不到任何东西，会重现同一个失败。

**沿用上游 `nightly` 频道并发布 `nightly-linux.yml`。** 已在[合并笔记](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.zh.md)中否决：频道名将必须流经 electron-builder 配置、发布资产列表和 updater，而 provider 自己解析出的名字没有任何劣势。

## Consequences

针对 `Oissp/dsh-desktop-linux-release` 的更新检查会解析出最新的匹配版本，而不是直接失败。代价是每次检查浪费一次请求：客户端请求 `alpha-linux.yml`，因为发布只有 `latest-linux.yml` 而得到 404，随后重试默认名。

fork 相对上游在 `update-coordinator.ts` 上的差异也从「把 `'nightly'` 换成另一个字面量」缩小为「删掉这行赋值」，因此只有上游重构该构造函数时才需要重新套用这次删除。

## Testing

`apps/desktop/tests/update-coordinator.spec.ts` 断言协调器让它设置的各个标志之外，`updater.channel` 保持 undefined，因此重新钉住频道会让 `package-deb.yml` 在打包前运行的桌面测试失败。
