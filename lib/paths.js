/**
 * 本地数据库位置。
 *
 * 数据库放在 `$DSH_HOME/calendar/calendar.sqlite`（DSH_HOME 未设置时退到
 * `~/.dsh/calendar/`）。与插件代码分开，升级/卸载插件不会碰用户数据。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/** @returns {string} 本地日历数据目录。 */
export function calendarHome() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'calendar')
}

/**
 * 返回数据库文件路径，并确保目录存在。
 * @param {{ home?: string }} [options] - 测试时可覆盖目录。
 */
export function calendarPaths(options = {}) {
  const home = options.home ?? calendarHome()
  const dir = join(home, 'db')
  const bin = join(home, 'bin')
  mkdirSync(dir, { recursive: true })
  mkdirSync(bin, { recursive: true })
  return { home, db: dir, bin, dbFile: join(dir, 'calendar.sqlite') }
}
