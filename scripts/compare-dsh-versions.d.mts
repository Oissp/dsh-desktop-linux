/**
 * Declarations for the sync-upstream semver gate. The implementation stays
 * plain JS (runs without a build step); this sibling declaration gives
 * host-context TypeScript consumers a checked signature.
 */

/** `target` 对 `locked` 的 semver 顺序：-1 小于，0 相等，1 大于；非法输入抛错。 */
export function compare(target: string, locked: string): -1 | 0 | 1
