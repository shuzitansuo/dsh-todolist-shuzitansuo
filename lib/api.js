/**
 * `/calendar/api` 端点。
 *
 * 信任边界：只接受本机回环地址上的请求，并要求客户端带上 `x-calendar-client`
 * 头。这个头会让浏览器跨站请求先触发 CORS 预检，从而挡住别的网页偷偷改数据。
 */

import { checkForUpdate, normalizeRepo } from './update.js'
import { applyUpdate, requestRestart } from './updater.js'
import { readLocalEvents } from './apple-calendar.js'
import { calendarHome } from './paths.js'

export const API_PREFIX = '/calendar/api'

const MAX_BODY = 1024 * 1024

const DEFAULT_DAY_START = 8 * 60
const DEFAULT_DAY_END = 24 * 60
const DAY_RANGE_STEP = 30

function readDayRange(store) {
  const startText = String(store.getSetting('day_start') || '').trim()
  const endText = String(store.getSetting('day_end') || '').trim()
  const rawStart = startText === '' ? NaN : Number(startText)
  const rawEnd = endText === '' ? NaN : Number(endText)
  let start = Number.isInteger(rawStart)
    && rawStart >= 0
    && rawStart <= 24 * 60 - 60
    && rawStart % DAY_RANGE_STEP === 0
    ? rawStart
    : DEFAULT_DAY_START
  let end = Number.isInteger(rawEnd)
    && rawEnd > start
    && rawEnd <= 24 * 60
    && rawEnd % DAY_RANGE_STEP === 0
    ? rawEnd
    : DEFAULT_DAY_END
  if (end - start < 60) start = Math.max(0, end - 60)
  return { dayStart: start, dayEnd: end }
}

function settingsPayload(store) {
  return {
    skin: store.getSetting('skin') || 'blue',
    syncCalendar: store.getSetting('sync_calendar') === '1',
    ...readDayRange(store),
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isTrustedRequest(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '' || host.includes('/')) return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(String(origin)).host !== hostUrl.host) return false
    } catch {
      return false
    }
  }
  return req.headers['x-calendar-client'] === '1'
}

function subPath(req) {
  const raw = req.url ?? '/'
  const path = raw.split('?')[0]
  if (!path.startsWith(API_PREFIX)) return '/'
  const rest = path.slice(API_PREFIX.length)
  return rest === '' ? '/' : rest
}

function sendJson(res, status, payload) {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 建立 HTTP 处理器。
 * @param {ReturnType<import('./store.js').openCalendar>} store
 * @param {() => string} dbFile
 */
export function createCalendarHandler(store, dbFile, home = calendarHome(), obsidian = null) {
  return function handle(req, res) {
    void (async () => {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const method = req.method ?? 'GET'
      const route = subPath(req)
      const query = new URL(req.url ?? '/', 'http://local').searchParams

      try {
        if (method === 'GET' && (route === '/' || route === '/health')) {
          sendJson(res, 200, { ok: true, name: 'dsh-calendar', db: dbFile(), tasks: store.list().length })
          return
        }

        if (method === 'GET' && route === '/tasks') {
          sendJson(res, 200, { ok: true, tasks: store.list() })
          return
        }

        if (method === 'GET' && route === '/categories') {
          sendJson(res, 200, { ok: true, categories: store.listCategories() })
          return
        }

        if (method === 'GET' && route === '/pomodoro') {
          const from = query.get('from')
          const to = query.get('to')
          if (from || to) {
            sendJson(res, 200, { ok: true, stats: store.pomodoroRange(from, to) })
          } else {
            sendJson(res, 200, { ok: true, stats: store.pomodoroStats(query.get('date')) })
          }
          return
        }

        if (method === 'GET' && route === '/update') {
          const result = await checkForUpdate({
            repo: store.getSetting('update_repo'),
            force: query.get('force') === '1',
          })
          sendJson(res, 200, Object.assign({ ok: true }, result))
          return
        }

        if (method === 'GET' && route === '/settings') {
          sendJson(res, 200, { ok: true, settings: settingsPayload(store) })
          return
        }

        if (method === 'GET' && route === '/obsidian') {
          if (!obsidian) {
            sendJson(res, 503, { ok: false, error: 'Obsidian 同步未初始化' })
            return
          }
          sendJson(res, 200, { ok: true, obsidian: obsidian.status() })
          return
        }

        if (method === 'GET' && route === '/local-events') {
          const from = query.get('from')
          const to = query.get('to')
          if (store.getSetting('sync_calendar') !== '1') {
            sendJson(res, 200, { ok: true, enabled: false, events: [], calendars: [] })
            return
          }
          try {
            const result = await readLocalEvents({
              home,
              from,
              to,
              force: query.get('force') === '1',
            })
            sendJson(res, 200, { ok: true, enabled: true, ...result })
          } catch (error) {
            sendJson(res, 200, {
              ok: true,
              enabled: true,
              events: [],
              calendars: [],
              error: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }

        if (method === 'GET' && route === '/reflection') {
          sendJson(res, 200, { ok: true, reflection: store.getReflection(query.get('period')) })
          return
        }

        if (method === 'GET' && route === '/subtasks') {
          sendJson(res, 200, { ok: true, subtasks: store.listSubtasks(query.get('taskId')) })
          return
        }

        if (method === 'GET' && route === '/task') {
          const task = store.get(Number(query.get('id')))
          if (!task) {
            sendJson(res, 404, { ok: false, error: '任务不存在' })
            return
          }
          sendJson(res, 200, { ok: true, task })
          return
        }

        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }

        const body = await readJson(req)

        if (route === '/category-create') {
          sendJson(res, 201, { ok: true, category: store.createCategory(body) })
          return
        }

        if (route === '/category-update') {
          sendJson(res, 200, { ok: true, category: store.updateCategory(Number(body.id), body) })
          return
        }

        if (route === '/category-delete') {
          sendJson(res, 200, { ok: true, ...store.deleteCategory(Number(body.id)) })
          return
        }

        if (route === '/task-category') {
          sendJson(res, 200, { ok: true, task: store.setTaskCategory(Number(body.id), body.categoryId) })
          return
        }

        if (route === '/task-create') {
          sendJson(res, 201, { ok: true, task: store.create(body) })
          return
        }

        if (route === '/task-status') {
          sendJson(res, 200, { ok: true, task: store.setStatus(Number(body.id), String(body.statusKey || '')) })
          return
        }

        if (route === '/task-deadline') {
          sendJson(res, 200, { ok: true, task: store.setDeadline(Number(body.id), String(body.deadline || '')) })
          return
        }

        if (route === '/task-schedule') {
          sendJson(res, 200, { ok: true, task: store.schedule(Number(body.id), body) })
          return
        }

        if (route === '/task-desc') {
          sendJson(res, 200, { ok: true, task: store.setDescription(Number(body.id), String(body.description || '')) })
          return
        }

        if (route === '/task-priority') {
          sendJson(res, 200, { ok: true, task: store.setPriority(Number(body.id), body.priority) })
          return
        }

        if (route === '/task-quadrant') {
          sendJson(res, 200, { ok: true, task: store.setQuadrant(Number(body.id), body.quadrant) })
          return
        }

        if (route === '/task-delete') {
          sendJson(res, 200, { ok: true, task: store.remove(Number(body.id)) })
          return
        }

        if (route === '/subtask-create') {
          sendJson(res, 201, { ok: true, subtasks: store.createSubtask(body) })
          return
        }

        if (route === '/subtask-toggle') {
          sendJson(res, 200, { ok: true, subtasks: store.setSubtaskDone(Number(body.id), Boolean(body.done)) })
          return
        }

        if (route === '/subtask-delete') {
          sendJson(res, 200, { ok: true, subtasks: store.removeSubtask(Number(body.id)) })
          return
        }

        if (route === '/pomodoro') {
          const recorded = store.recordPomodoro(body)
          sendJson(res, 201, { ok: true, session: recorded.session, task: recorded.task })
          return
        }

        if (route === '/obsidian') {
          if (!obsidian) {
            sendJson(res, 503, { ok: false, error: 'Obsidian 同步未初始化' })
            return
          }
          obsidian.saveConfig(body)
          let writeError = ''
          if (body.sync) {
            try {
              await obsidian.syncNow()
            } catch (error) {
              writeError = error instanceof Error ? error.message : String(error)
            }
          }
          sendJson(res, 200, { ok: true, obsidian: obsidian.status(), writeError })
          return
        }

        if (route === '/obsidian-sync') {
          if (!obsidian) {
            sendJson(res, 503, { ok: false, error: 'Obsidian 同步未初始化' })
            return
          }
          try {
            await obsidian.syncNow()
            sendJson(res, 200, { ok: true, obsidian: obsidian.status() })
          } catch (error) {
            sendJson(res, 400, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              obsidian: obsidian.status(),
            })
          }
          return
        }

        if (route === '/settings') {
          if (body.skin !== undefined) {
            const skin = String(body.skin || '')
            if (!['blue', 'teal', 'violet', 'coral', 'rose', 'graphite'].includes(skin)) {
              sendJson(res, 400, { ok: false, error: '皮肤颜色不合法' })
              return
            }
            store.setSetting('skin', skin)
          }
          if (body.syncCalendar !== undefined) {
            store.setSetting('sync_calendar', body.syncCalendar ? '1' : '0')
          }
          if (body.dayStart !== undefined || body.dayEnd !== undefined) {
            const current = readDayRange(store)
            const start = body.dayStart === undefined ? current.dayStart : Number(body.dayStart)
            const end = body.dayEnd === undefined ? current.dayEnd : Number(body.dayEnd)
            if (
              !Number.isInteger(start)
              || !Number.isInteger(end)
              || start < 0
              || end > 24 * 60
              || end - start < 60
              || start % DAY_RANGE_STEP !== 0
              || end % DAY_RANGE_STEP !== 0
            ) {
              sendJson(res, 400, { ok: false, error: '日视图时间范围不合法' })
              return
            }
            store.setSetting('day_start', String(start))
            store.setSetting('day_end', String(end))
          }
          sendJson(res, 200, {
            ok: true,
            settings: settingsPayload(store),
          })
          return
        }

        if (route === '/update-apply') {
          const info = await checkForUpdate({
            repo: store.getSetting('update_repo'),
            force: true,
          })
          if (info.error) {
            sendJson(res, 400, { ok: false, error: info.error })
            return
          }
          if (!info.configured) {
            sendJson(res, 400, { ok: false, error: '还没有设置 GitHub 更新源' })
            return
          }
          if (!info.hasUpdate || !info.downloadUrl) {
            sendJson(res, 400, { ok: false, error: '已经是最新版本，无需更新' })
            return
          }
          try {
            const applied = await applyUpdate({
              downloadUrl: info.downloadUrl,
              expectedVersion: info.latest,
            })
            const restart = body.restart === false
              ? { started: false, reason: 'requested' }
              : await requestRestart()
            sendJson(res, 200, {
              ok: true,
              update: applied,
              restart,
              tag: info.tag,
            })
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }

        if (route === '/update-repo') {
          const repo = normalizeRepo(body.repo)
          if (!repo) {
            sendJson(res, 400, { ok: false, error: '请填写 GitHub 仓库，例如 owner/repo' })
            return
          }
          store.setSetting('update_repo', repo)
          sendJson(res, 200, { ok: true, repo })
          return
        }

        if (route === '/reflection') {
          sendJson(res, 200, {
            ok: true,
            reflection: store.saveReflection(body.periodKey, body.content),
          })
          return
        }

        sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = /不存在/.test(message) ? 404 : 400
        sendJson(res, status, { ok: false, error: message })
      }
    })()
  }
}
