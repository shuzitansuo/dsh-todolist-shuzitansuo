/**
 * 把今天的任务写入 Obsidian 的当天日志。
 *
 * 规则：
 * - 文件固定为 `<vault>/YYYY-MM-DD.md`；
 * - 只替换配置标题（如 `## todo`）下的内容，直到下一个同级/更高级标题；
 * - 未完成在前、已完成在后；已放弃不计入；
 * - 每次覆盖该节，不重复追加。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dailySummaryLines } from './daily-summary.js'

const DEFAULT_HEADING = '## todo'
const SUMMARY_HEADING = '## 今日总结'
const DEFAULT_INTERVAL = 30
const MAX_INTERVAL = 1440
const MIN_INTERVAL = 1
const MAX_TITLE = 200

function pad2(value) {
  return String(value).padStart(2, '0')
}

function localDay(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function localClock(minutes) {
  const total = Math.max(0, Math.min(24 * 60, Math.round(Number(minutes) || 0)))
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

function expandHome(value) {
  const text = String(value || '').trim()
  if (text === '~') return process.env.HOME || text
  if (text.startsWith('~/')) return path.join(process.env.HOME || '', text.slice(2))
  return text
}

function headingText(value) {
  return String(value || '').replace(/^#+\s*/, '').trim()
}

function normalizeHeading(value) {
  let heading = String(value || '').trim().replace(/\s+/g, ' ')
  if (!heading) heading = DEFAULT_HEADING
  if (!/^#{1,6}\s+/.test(heading)) {
    heading = '## ' + heading.replace(/^#+\s*/, '')
  }
  heading = heading.replace(/^(#{1,6})([^#\s])/, '$1 $2').trim()
  if (heading.length > 120) throw new Error('标题不能超过 120 个字符')
  if (headingText(heading) === '今日总结') throw new Error('任务标题不能使用「今日总结」')
  return heading
}

function normalizeInterval(value) {
  const minutes = Math.round(Number(value))
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL || minutes > MAX_INTERVAL) {
    throw new Error(`写入间隔需在 ${MIN_INTERVAL}–${MAX_INTERVAL} 分钟之间`)
  }
  return minutes
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE) || '未命名任务'
}

function isDropped(task) {
  return ['dropped', 'pause', 'cancel'].includes(String(task.status || ''))
}

function taskLine(task) {
  const checked = task.done ? 'x' : ' '
  const time = task.startTime !== null && task.startTime !== undefined ? localClock(task.startTime) + ' ' : ''
  return `- [${checked}] ${time}${cleanTitle(task.title)}`
}

function taskBlock(tasks, day) {
  const open = tasks.filter((task) => !task.done)
  const done = tasks.filter((task) => task.done)
  const lines = [`> ${day} · ${open.length} 项未完成 · ${done.length} 项已完成`, '']
  if (!tasks.length) {
    lines.push('- 今日暂无任务')
    return lines
  }
  for (const task of open) lines.push(taskLine(task))
  if (open.length && done.length) lines.push('')
  for (const task of done) lines.push(taskLine(task))
  return lines
}

function replaceSection(content, heading, blockLines, stopHeadings = []) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const level = (heading.match(/^#+/) || [''])[0].length
  const index = lines.findIndex((line) => line.trim() === heading)
  const block = blockLines.join(eol)

  if (index < 0) {
    const base = content.replace(/\s+$/, '')
    return (base ? base + eol + eol : '') + heading + eol + eol + block + eol
  }

  let end = lines.length
  for (let i = index + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (stopHeadings.includes(trimmed)) {
      end = i
      break
    }
    const match = lines[i].match(/^(#{1,6})\s+/)
    if (match && match[1].length <= level) {
      end = i
      break
    }
  }

  const before = lines.slice(0, index + 1)
  while (before.length > 1 && before[before.length - 1] === '') before.pop()
  const after = lines.slice(end)
  const result = [...before, '', ...blockLines, '']
  if (after.length) result.push(...after)
  return result.join(eol).replace(new RegExp(`(?:${eol === '\r\n' ? '\\r\\n' : '\\n'}){3,}`, 'g'), eol + eol).replace(/\s+$/, '') + eol
}

export function createObsidianSync(store) {
  let timer = null
  let running = false

  function readConfig() {
    return {
      enabled: store.getSetting('obsidian_enabled') === '1',
      vault: store.getSetting('obsidian_vault') || '',
      heading: store.getSetting('obsidian_heading') || DEFAULT_HEADING,
      intervalMinutes: Number(store.getSetting('obsidian_interval_minutes')) || DEFAULT_INTERVAL,
    }
  }

  function status() {
    return {
      ...readConfig(),
      lastSyncAt: store.getSetting('obsidian_last_sync_at') || '',
      lastResult: store.getSetting('obsidian_last_result') || '',
      lastError: store.getSetting('obsidian_last_error') || '',
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = null
    const config = readConfig()
    if (!config.enabled || !config.vault) return
    const delay = Math.max(MIN_INTERVAL, config.intervalMinutes) * 60 * 1000
    timer = setTimeout(async () => {
      timer = null
      try {
        await syncNow()
      } catch (error) {
        console.error('calendar: obsidian sync failed:', error instanceof Error ? error.message : error)
      } finally {
        schedule()
      }
    }, delay)
  }

  async function syncNow() {
    if (running) return status()
    const config = readConfig()
    if (!config.vault) throw new Error('请先填写 Obsidian 仓库目录')
    if (headingText(config.heading) === '今日总结') {
      throw new Error('任务标题不能使用「今日总结」')
    }
    const vault = path.resolve(expandHome(config.vault))
    let info
    try {
      info = await fs.stat(vault)
    } catch {
      throw new Error('Obsidian 仓库目录不存在')
    }
    if (!info.isDirectory()) throw new Error('Obsidian 仓库路径不是目录')

    running = true
    try {
      const day = localDay()
      const file = path.join(vault, `${day}.md`)
      const allTasks = store.list()
      const tasks = allTasks
        .filter((task) => task.deadline === day && !isDropped(task))
        .sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1
          const at = a.startTime === null || a.startTime === undefined ? 24 * 60 : Number(a.startTime)
          const bt = b.startTime === null || b.startTime === undefined ? 24 * 60 : Number(b.startTime)
          if (at !== bt) return at - bt
          return a.id - b.id
        })
      const pomodoro = store.pomodoroStats(day)
      const reflection = store.getReflection('day:' + day)
      let content = ''
      try {
        content = await fs.readFile(file, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      let next = replaceSection(content, config.heading, taskBlock(tasks, day), [SUMMARY_HEADING])
      next = replaceSection(
        next,
        SUMMARY_HEADING,
        dailySummaryLines({
          day,
          tasks,
          allTasks,
          pomodoro,
          reflection: reflection ? reflection.content : '',
        }),
        [config.heading],
      )
      const temp = path.join(vault, `.dsh-calendar-${process.pid}-${Date.now()}.tmp`)
      await fs.writeFile(temp, next, 'utf8')
      await fs.rename(temp, file)
      store.setSetting('obsidian_last_sync_at', new Date().toISOString())
      store.setSetting('obsidian_last_result', `已写入 ${day}.md（${tasks.length} 项任务 · 含总结）`)
      store.setSetting('obsidian_last_error', '')
      return status()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      store.setSetting('obsidian_last_sync_at', new Date().toISOString())
      store.setSetting('obsidian_last_result', '')
      store.setSetting('obsidian_last_error', message)
      throw error
    } finally {
      running = false
    }
  }

  function saveConfig(input = {}) {
    const enabled = Boolean(input.enabled)
    const rawVault = expandHome(input.vault)
    if (rawVault && !path.isAbsolute(rawVault)) throw new Error('请填写 Obsidian 仓库的绝对路径')
    const vault = rawVault ? path.resolve(rawVault) : ''
    if (enabled && !vault) throw new Error('开启定时写入前，请填写 Obsidian 仓库目录')
    const heading = normalizeHeading(input.heading)
    const intervalMinutes = normalizeInterval(input.intervalMinutes === undefined ? DEFAULT_INTERVAL : input.intervalMinutes)
    store.setSetting('obsidian_enabled', enabled ? '1' : '0')
    store.setSetting('obsidian_vault', vault)
    store.setSetting('obsidian_heading', heading)
    store.setSetting('obsidian_interval_minutes', String(intervalMinutes))
    schedule()
    return status()
  }

  function start() {
    schedule()
  }

  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { readConfig, status, saveConfig, syncNow, start, stop }
}
