import { valid } from 'semver'

/**
 * Whether a desktop shell version is a release of the bundled engine version:
 * either identical, or the engine version extended with a semver build counter
 * (e.g. engine `0.1.5-rc.2` → shell `0.1.5-rc.2.1`). Shell-only patches bump the
 * trailing counter without touching the engine version, so both the runtime-tree
 * integrity check and the package-target version guard accept them.
 */
export function shellVersionExtendsEngine(desktopVersion: string, engineVersion: string): boolean {
  return valid(desktopVersion) !== null
    && (desktopVersion === engineVersion || desktopVersion.startsWith(`${engineVersion}.`))
}
