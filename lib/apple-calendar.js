/**
 * 读取 macOS 本机日历。
 *
 * 直接走 EventKit 需要在系统里获得日历权限。`osascript` 读取一次要 20 秒左右，
 * 因此这里编译一个极小的 `.app`（带 usage description），通过 LaunchServices
 * 启动，让系统把权限授予这个 helper；查询本身是毫秒级。
 *
 * 只读：不会修改、创建或删除日历里的任何日程。
 */

import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calendarHome } from './paths.js'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'CalendarSync.swift')
const BUNDLE_ID = 'local.dsh.calendar.sync'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CACHE_TTL = 60 * 1000
const cache = new Map()

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>CalendarSync</string>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
<key>CFBundleName</key><string>CalendarSync</string>
<key>CFBundleDisplayName</key><string>任务日历同步</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSUIElement</key><true/>
<key>NSCalendarsFullAccessUsageDescription</key><string>读取本机日历日程，用于在任务日历中同步显示。不会修改系统日历。</string>
<key>NSCalendarsUsageDescription</key><string>读取本机日历日程，用于在任务日历中同步显示。不会修改系统日历。</string>
</dict></plist>
`

function run(file, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message || '').trim()
        reject(new Error(detail.length > 600 ? detail.slice(-600) : detail))
        return
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

async function ensureHelper(home) {
  const binDir = join(home, 'bin')
  const appDir = join(binDir, 'CalendarSync.app')
  const contents = join(appDir, 'Contents')
  const macos = join(contents, 'MacOS')
  const binary = join(macos, 'CalendarSync')
  const plist = join(contents, 'Info.plist')
  await mkdir(macos, { recursive: true })
  await writeFile(plist, INFO_PLIST, 'utf8')

  let sourceTime = 0
  try {
    sourceTime = (await stat(SOURCE)).mtimeMs
  } catch {
    throw new Error('缺少 CalendarSync.swift，无法读取本机日历')
  }
  let binaryTime = 0
  try {
    binaryTime = (await stat(binary)).mtimeMs
  } catch {
    binaryTime = 0
  }

  if (binaryTime < sourceTime) {
    try {
      await run('/usr/bin/swiftc', ['-O', SOURCE, '-o', binary], 180000)
      await chmod(binary, 0o755)
    } catch (error) {
      throw new Error('编译日历读取组件失败。请先安装 Xcode 命令行工具（终端运行 xcode-select --install）。' + (error.message ? ' ' + error.message : ''))
    }
    try {
      await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appDir], 60000)
    } catch (error) {
      throw new Error('日历读取组件签名失败：' + error.message)
    }
  }
  return { appDir, binary }
}

function normalizeRange(fromInput, toInput) {
  if (!DATE_RE.test(String(fromInput || '')) || !DATE_RE.test(String(toInput || ''))) {
    throw new Error('日期格式应为 YYYY-MM-DD')
  }
  const from = new Date(`${fromInput}T00:00:00`)
  const to = new Date(`${toInput}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw new Error('日期范围不合法')
  }
  if ((to - from) / 86400000 > 366) throw new Error('一次最多同步 366 天')
  const end = new Date(to)
  end.setDate(end.getDate() + 1)
  return { fromKey: String(fromInput), toKey: String(toInput), start: from, end }
}

/**
 * 读取本机日历中的日程（只读）。
 * @param {{ home?: string, from: string, to: string, force?: boolean }} options
 */
export async function readLocalEvents({ home = calendarHome(), from, to, force = false }) {
  const range = normalizeRange(from, to)
  const key = `${home}|${range.fromKey}|${range.toKey}`
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.time < CACHE_TTL) return hit.value

  const { appDir } = await ensureHelper(home)
  const binDir = join(home, 'bin')
  const outFile = join(binDir, `out-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  try {
    await rm(outFile, { force: true })
    await run('/usr/bin/open', [
      '-g', '-W', '-n', '-a', appDir, '--args',
      range.start.toISOString(), range.end.toISOString(), outFile,
    ], 90000)
    let text = ''
    try {
      text = await readFile(outFile, 'utf8')
    } catch {
      throw new Error('日历读取没有返回结果。请确认系统弹窗里允许「任务日历同步」访问日历。')
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('日历读取返回了无法解析的内容')
    }
    if (parsed.error) throw new Error(parsed.error)
    const value = {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      calendars: Array.isArray(parsed.calendars) ? parsed.calendars : [],
      syncedAt: String(parsed.syncedAt || new Date().toISOString()),
    }
    cache.set(key, { time: Date.now(), value })
    return value
  } finally {
    await rm(outFile, { force: true }).catch(() => {})
  }
}

/** 清空短期缓存（设置变化或手动刷新时用）。 */
export function clearLocalEventsCache() {
  cache.clear()
}
