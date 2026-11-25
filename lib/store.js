/**
 * 本地任务存储：node:sqlite（Node 24 内置，无需原生模块）。
 *
 * 只存任务本身。日历的周/月/日展示、拖拽改期、日视图排期都
 * 落在这张表里，所以换机器只要拷 calendar.sqlite 就能还原。
 */

import { DatabaseSync } from 'node:sqlite'

/** 状态值与中文名。顺序即右键菜单顺序。 */
export const STATUS_LABEL = {
  wait: '未开始',
  doing: '进行中',
  done: '已完成',
  dropped: '已放弃',
}
export const STATUS_KEYS = Object.keys(STATUS_LABEL)

/** 首次建库时的默认分类；颜色用于任务卡片和总结时间格。 */
export const DEFAULT_CATEGORIES = [
  { name: '工作', color: '#2f7cf6' },
  { name: '生活', color: '#22a06b' },
  { name: '学习', color: '#7c5cff' },
  { name: '健康', color: '#e37318' },
  { name: '娱乐', color: '#e5457a' },
  { name: '放松', color: '#0f9f8f' },
]
const normalizeStatus = (value) => (value === 'pause' || value === 'cancel' ? 'dropped' : value)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TITLE = 300
const MAX_DESC = 20000
const MAX_NOTE = 20000
const PERIOD_RE = /^(day|week|month):\d{4}-\d{2}-\d{2}$/

function nowIso() {
  return new Date().toISOString()
}

function localDay(date = new Date()) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function cleanText(value, max) {
  return String(value === undefined || value === null ? '' : value).slice(0, max)
}

/** @param {unknown} value */
function isDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(new Date(value + 'T00:00:00').getTime())
}

function toRow(row) {
  return row === undefined ? undefined : { ...row }
}

/** 分类颜色统一为 #rrggbb。 */
export function cleanColor(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) throw new Error('分类颜色不合法')
  return text.toLowerCase()
}

/** 分类行转前端形状。 */
export function categoryView(row) {
  const data = toRow(row)
  if (!data) return null
  return {
    id: Number(data.id),
    name: String(data.name || ''),
    color: String(data.color || ''),
    sortOrder: Number(data.sort_order) || 0,
    taskCount: Number(data.task_count) || 0,
    createdAt: String(data.created_at || ''),
    updatedAt: String(data.updated_at || ''),
  }
}

/** 子任务行转前端形状。 */
export function subtaskView(row) {
  const data = toRow(row)
  if (!data) return null
  return {
    id: Number(data.id),
    taskId: Number(data.task_id),
    title: String(data.title || ''),
    done: Boolean(data.done),
    sortOrder: Number(data.sort_order) || 0,
    createdAt: String(data.created_at || ''),
    updatedAt: String(data.updated_at || ''),
  }
}

/** 把数据库行转成前端直接可用的形状。 */
export function taskView(row) {
  const data = toRow(row)
  if (!data) return null
  const status = normalizeStatus(String(data.status || 'wait'))
  return {
    id: Number(data.id),
    title: String(data.title || ''),
    description: String(data.description || ''),
    status,
    statusText: STATUS_LABEL[status] || status,
    done: status === 'done',
    priority: Number(data.priority) || 3,
    deadline: String(data.deadline || ''),
    estimate: Number(data.estimate) || 0,
    startTime: data.start_time === null || data.start_time === undefined ? null : Number(data.start_time),
    quadrant: [1, 2, 3, 4].includes(Number(data.quadrant)) ? Number(data.quadrant) : null,
    categoryId: data.category_id === null || data.category_id === undefined ? null : Number(data.category_id),
    categoryName: String(data.category_name || ''),
    categoryColor: String(data.category_color || ''),
    createdAt: String(data.created_at || ''),
    updatedAt: String(data.updated_at || ''),
    pomodoroCount: Number(data.pomodoro_count) || 0,
    focusSeconds: Number(data.focus_seconds) || 0,
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      color       TEXT    NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'wait',
      priority    INTEGER NOT NULL DEFAULT 3,
      deadline    TEXT    NOT NULL,
      estimate    REAL    NOT NULL DEFAULT 1,
      start_time  INTEGER,
      quadrant    INTEGER,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
    CREATE TABLE IF NOT EXISTS pomodoro_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id          INTEGER NOT NULL,
      mode             TEXT    NOT NULL DEFAULT 'countdown',
      planned_minutes  INTEGER NOT NULL DEFAULT 25,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      started_at       TEXT    NOT NULL,
      ended_at         TEXT    NOT NULL,
      day              TEXT    NOT NULL,
      completed        INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pomodoro_day ON pomodoro_sessions(day);
    CREATE INDEX IF NOT EXISTS idx_pomodoro_task ON pomodoro_sessions(task_id);
    CREATE TABLE IF NOT EXISTS reflections (
      period_key TEXT PRIMARY KEY,
      content    TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subtasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL,
      title       TEXT    NOT NULL,
      done        INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
  `)
  // v2：暂停/取消两个状态合并为「已放弃」。
  const version = Number(db.prepare('PRAGMA user_version').get().user_version) || 0
  if (version < 2) {
    db.exec("UPDATE tasks SET status = 'dropped' WHERE status IN ('pause', 'cancel')")
    db.exec('PRAGMA user_version = 2')
  }
  // v3：番茄钟专注记录。
  if (version < 3) db.exec('PRAGMA user_version = 3')
  // v4：总结页的「我的感想」，按日/周/月周期保存。
  if (version < 4) db.exec('PRAGMA user_version = 4')
  // v5：本地设置（目前用于检查更新时的 GitHub 仓库地址）。
  if (version < 5) db.exec('PRAGMA user_version = 5')
  // v6：四象限的手动归类；为空时仍按优先级/截止日期自动归类。
  if (version < 6) {
    const columns = db.prepare('PRAGMA table_info(tasks)').all()
    if (!columns.some((column) => column.name === 'quadrant')) {
      db.exec('ALTER TABLE tasks ADD COLUMN quadrant INTEGER')
    }
    db.exec('PRAGMA user_version = 6')
  }
  // v7：任务分类；首次迁移写入默认分类。
  if (version < 7) {
    const columns = db.prepare('PRAGMA table_info(tasks)').all()
    if (!columns.some((column) => column.name === 'category_id')) {
      db.exec('ALTER TABLE tasks ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL')
    }
    const count = Number(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n) || 0
    if (count === 0) {
      const stamp = nowIso()
      const insert = db.prepare(
        'INSERT INTO categories (name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      DEFAULT_CATEGORIES.forEach((item, index) => {
        insert.run(item.name, item.color, index, stamp, stamp)
      })
    }
    db.exec('PRAGMA user_version = 7')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id)')
  // v8：任务详情里的子任务。
  if (version < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     INTEGER NOT NULL,
        title       TEXT    NOT NULL,
        done        INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
    `)
    db.exec('PRAGMA user_version = 8')
  }
}

/**
 * 打开（或新建）本地日历库。
 * @param {string} file - sqlite 文件绝对路径。
 * @returns {ReturnType<typeof buildStore>}
 */
export function openCalendar(file) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  return buildStore(db)
}

function buildStore(db) {
  const taskSelect = `
    SELECT t.*,
      c.name AS category_name,
      c.color AS category_color,
      COALESCE((SELECT SUM(p.duration_seconds) FROM pomodoro_sessions p WHERE p.task_id = t.id), 0) AS focus_seconds,
      COALESCE((SELECT COUNT(*) FROM pomodoro_sessions p WHERE p.task_id = t.id AND p.mode = 'countdown' AND p.completed = 1), 0) AS pomodoro_count
    FROM tasks t
    LEFT JOIN categories c ON c.id = t.category_id`
  const listStmt = db.prepare(taskSelect + ' ORDER BY t.deadline ASC, t.id ASC')
  const getStmt = db.prepare(taskSelect + ' WHERE t.id = ?')
  const insertStmt = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, deadline, estimate, start_time, quadrant, category_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const categoryListStmt = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id) AS task_count
    FROM categories c ORDER BY c.sort_order ASC, c.id ASC`)
  const categoryGetStmt = db.prepare('SELECT * FROM categories WHERE id = ?')
  const categoryByNameStmt = db.prepare('SELECT * FROM categories WHERE name = ?')
  const categoryInsertStmt = db.prepare(`
    INSERT INTO categories (name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
  const categoryUpdateStmt = db.prepare('UPDATE categories SET name = ?, color = ?, updated_at = ? WHERE id = ?')
  const categoryDeleteStmt = db.prepare('DELETE FROM categories WHERE id = ?')
  const categoryMaxOrderStmt = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM categories')
  const clearCategoryStmt = db.prepare('UPDATE tasks SET category_id = NULL, updated_at = ? WHERE category_id = ?')
  const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?')
  const deleteSessionsStmt = db.prepare('DELETE FROM pomodoro_sessions WHERE task_id = ?')
  const insertSessionStmt = db.prepare(`
    INSERT INTO pomodoro_sessions (task_id, mode, planned_minutes, duration_seconds, started_at, ended_at, day, completed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const sessionSelect = `
    SELECT p.*, t.title AS task_title
    FROM pomodoro_sessions p
    LEFT JOIN tasks t ON t.id = p.task_id`
  const sessionsByDayStmt = db.prepare(sessionSelect + ' WHERE p.day = ? ORDER BY p.ended_at DESC, p.id DESC')
  const sessionsByRangeStmt = db.prepare(sessionSelect + ' WHERE p.day BETWEEN ? AND ?')
  const reflectionStmt = db.prepare('SELECT * FROM reflections WHERE period_key = ?')
  const reflectionUpsertStmt = db.prepare(`
    INSERT INTO reflections (period_key, content, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(period_key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `)
  const settingStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const settingUpsertStmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
  const subtaskListStmt = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC, id ASC')
  const subtaskGetStmt = db.prepare('SELECT * FROM subtasks WHERE id = ?')
  const subtaskCountStmt = db.prepare('SELECT COUNT(*) AS n FROM subtasks WHERE task_id = ?')
  const subtaskMaxOrderStmt = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM subtasks WHERE task_id = ?')
  const subtaskInsertStmt = db.prepare(`
    INSERT INTO subtasks (task_id, title, done, sort_order, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?, ?)
  `)
  const subtaskToggleStmt = db.prepare('UPDATE subtasks SET done = ?, updated_at = ? WHERE id = ?')
  const subtaskDeleteStmt = db.prepare('DELETE FROM subtasks WHERE id = ?')
  const deleteSubtasksStmt = db.prepare('DELETE FROM subtasks WHERE task_id = ?')

  const touch = (id, patch, values) => {
    const task = taskView(toRow(getStmt.get(id)))
    if (!task) throw new Error('任务不存在')
    db.prepare(`UPDATE tasks SET ${patch}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id)
    return taskView(toRow(getStmt.get(id)))
  }

  const cleanPeriod = (value) => {
    const key = String(value || '').trim()
    if (!PERIOD_RE.test(key) || !isDate(key.slice(key.indexOf(':') + 1))) {
      throw new Error('总结周期不合法')
    }
    return key
  }

  const reflectionView = (row) => {
    const data = toRow(row)
    return {
      periodKey: data ? String(data.period_key || '') : '',
      content: data ? String(data.content || '') : '',
      updatedAt: data ? String(data.updated_at || '') : '',
    }
  }

  const sessionView = (row) => {
    const data = toRow(row)
    if (!data) return null
    return {
      id: Number(data.id),
      taskId: Number(data.task_id),
      taskTitle: String(data.task_title || ''),
      mode: data.mode === 'countup' ? 'countup' : 'countdown',
      plannedMinutes: Number(data.planned_minutes) || 0,
      durationSeconds: Number(data.duration_seconds) || 0,
      startedAt: String(data.started_at || ''),
      endedAt: String(data.ended_at || ''),
      day: String(data.day || ''),
      completed: Boolean(data.completed),
    }
  }

  return {
    listSubtasks(taskId) {
      const id = Number(taskId)
      if (!Number.isFinite(id)) return []
      return subtaskListStmt.all(id).map((row) => subtaskView(toRow(row)))
    },

    createSubtask(input = {}) {
      const taskId = Number(input.taskId)
      if (!getStmt.get(taskId)) throw new Error('任务不存在')
      const title = cleanText(input.title, 80).trim()
      if (!title) throw new Error('请填写子任务标题')
      const count = Number(subtaskCountStmt.get(taskId).n) || 0
      if (count >= 10) throw new Error('最多添加 10 个子任务')
      const order = Number(subtaskMaxOrderStmt.get(taskId).n) + 1
      const stamp = nowIso()
      subtaskInsertStmt.run(taskId, title, order, stamp, stamp)
      return this.listSubtasks(taskId)
    },

    setSubtaskDone(id, done) {
      const current = subtaskGetStmt.get(Number(id))
      if (!current) throw new Error('子任务不存在')
      subtaskToggleStmt.run(done ? 1 : 0, nowIso(), Number(id))
      return this.listSubtasks(Number(current.task_id))
    },

    removeSubtask(id) {
      const current = subtaskGetStmt.get(Number(id))
      if (!current) throw new Error('子任务不存在')
      subtaskDeleteStmt.run(Number(id))
      return this.listSubtasks(Number(current.task_id))
    },

    listCategories() {
      return categoryListStmt.all().map((row) => categoryView(toRow(row)))
    },

    createCategory(input = {}) {
      const name = cleanText(input.name, 24).trim()
      if (!name) throw new Error('请填写分类名称')
      if (categoryByNameStmt.get(name)) throw new Error('分类名称已存在')
      if (Number(categoryMaxOrderStmt.get().n) >= 30) throw new Error('分类数量不能超过 30 个')
      const color = cleanColor(input.color)
      const stamp = nowIso()
      const order = Number(categoryMaxOrderStmt.get().n) + 1
      const result = categoryInsertStmt.run(name, color, order, stamp, stamp)
      return categoryView(toRow(categoryGetStmt.get(Number(result.lastInsertRowid))))
    },

    updateCategory(id, input = {}) {
      const current = categoryGetStmt.get(Number(id))
      if (!current) throw new Error('分类不存在')
      const name = input.name === undefined ? String(current.name) : cleanText(input.name, 24).trim()
      if (!name) throw new Error('请填写分类名称')
      const duplicate = categoryByNameStmt.get(name)
      if (duplicate && Number(duplicate.id) !== Number(id)) throw new Error('分类名称已存在')
      const color = input.color === undefined ? String(current.color) : cleanColor(input.color)
      categoryUpdateStmt.run(name, color, nowIso(), Number(id))
      return categoryView(toRow(categoryGetStmt.get(Number(id))))
    },

    deleteCategory(id) {
      const current = categoryGetStmt.get(Number(id))
      if (!current) throw new Error('分类不存在')
      const cleared = Number(clearCategoryStmt.run(nowIso(), Number(id)).changes) || 0
      categoryDeleteStmt.run(Number(id))
      return { category: categoryView(toRow(current)), tasksCleared: cleared }
    },

    setTaskCategory(id, categoryId) {
      const value = categoryId === null || categoryId === undefined || categoryId === '' ? null : Number(categoryId)
      if (value !== null && !categoryGetStmt.get(value)) throw new Error('分类不存在')
      return touch(Number(id), 'category_id = ?', [value])
    },

    list() {
      return listStmt.all().map((row) => taskView(row))
    },

    get(id) {
      return taskView(toRow(getStmt.get(Number(id))))
    },

    create(input = {}) {
      const title = cleanText(input.title, MAX_TITLE).trim()
      if (!title) throw new Error('请填写任务标题')
      if (!isDate(input.deadline)) throw new Error('请选择有效的截止日期')
      const status = STATUS_KEYS.includes(normalizeStatus(input.status)) ? normalizeStatus(input.status) : 'wait'
      const priority = [1, 2, 3].includes(Number(input.priority)) ? Number(input.priority) : 3
      const estimate = Math.max(0.25, Math.min(24, Number(input.estimate) || 1))
      const startTime = Number.isFinite(Number(input.startTime)) && input.startTime !== null
        ? Math.max(0, Math.min(1439, Math.round(Number(input.startTime))))
        : null
      const rawQuadrant = input.quadrant === null || input.quadrant === undefined || input.quadrant === '' ? null : Number(input.quadrant)
      if (rawQuadrant !== null && ![1, 2, 3, 4].includes(rawQuadrant)) throw new Error('象限只能是 1–4 或空')
      const rawCategory = input.categoryId === null || input.categoryId === undefined || input.categoryId === '' ? null : Number(input.categoryId)
      if (rawCategory !== null && !categoryGetStmt.get(rawCategory)) throw new Error('分类不存在')
      const stamp = nowIso()
      const result = insertStmt.run(
        title,
        cleanText(input.description, MAX_DESC),
        status,
        priority,
        input.deadline,
        estimate,
        startTime,
        rawQuadrant,
        rawCategory,
        stamp,
        stamp,
      )
      return this.get(Number(result.lastInsertRowid))
    },

    setStatus(id, statusKey) {
      const next = normalizeStatus(statusKey)
      if (!STATUS_KEYS.includes(next)) throw new Error('不支持的任务状态')
      return touch(Number(id), 'status = ?', [next])
    },

    setDeadline(id, deadline) {
      if (!isDate(deadline)) throw new Error('请选择有效的截止日期')
      return touch(Number(id), 'deadline = ?', [deadline])
    },

    setDescription(id, description) {
      return touch(Number(id), 'description = ?', [cleanText(description, MAX_DESC)])
    },

    setPriority(id, priority) {
      if (![1, 2, 3].includes(Number(priority))) throw new Error('优先级只能是 P1/P2/P3')
      return touch(Number(id), 'priority = ?', [Number(priority)])
    },

    setQuadrant(id, quadrant) {
      const value = quadrant === null || quadrant === undefined || quadrant === '' ? null : Number(quadrant)
      if (value !== null && ![1, 2, 3, 4].includes(value)) throw new Error('象限只能是 1–4 或空')
      return touch(Number(id), 'quadrant = ?', [value])
    },

    schedule(id, input = {}) {
      const estimate = Math.max(0.25, Math.min(24, Number(input.estimate) || 1))
      const startTime = Number.isFinite(Number(input.startTime)) && input.startTime !== null
        ? Math.max(0, Math.min(1439, Math.round(Number(input.startTime))))
        : null
      if (startTime === null) return touch(Number(id), 'estimate = ?', [estimate])
      return touch(Number(id), 'estimate = ?, start_time = ?', [estimate, startTime])
    },

    remove(id) {
      const task = this.get(id)
      if (!task) throw new Error('任务不存在')
      deleteSessionsStmt.run(Number(id))
      deleteSubtasksStmt.run(Number(id))
      deleteStmt.run(Number(id))
      return task
    },

    recordPomodoro(input = {}) {
      const taskId = Number(input.taskId)
      const task = this.get(taskId)
      if (!task) throw new Error('任务不存在')
      const mode = input.mode === 'countup' ? 'countup' : 'countdown'
      const plannedMinutes = mode === 'countup' ? 0 : Math.max(1, Math.min(180, Math.round(Number(input.plannedMinutes) || 25)))
      const durationSeconds = Math.max(1, Math.min(12 * 60 * 60, Math.round(Number(input.durationSeconds) || 0)))
      const day = isDate(input.day) ? input.day : localDay()
      const startDate = new Date(String(input.startedAt || ''))
      const startedAt = Number.isNaN(startDate.getTime()) ? nowIso() : startDate.toISOString()
      const endedAt = nowIso()
      const completed = mode === 'countdown' && Boolean(input.completed) ? 1 : 0
      const result = insertSessionStmt.run(
        taskId, mode, plannedMinutes, durationSeconds, startedAt, endedAt, day, completed, endedAt,
      )
      return {
        session: sessionView({ ...db.prepare('SELECT p.*, t.title AS task_title FROM pomodoro_sessions p LEFT JOIN tasks t ON t.id = p.task_id WHERE p.id = ?').get(Number(result.lastInsertRowid)) }),
        task: this.get(taskId),
      }
    },

    getReflection(periodKey) {
      const key = cleanPeriod(periodKey)
      const row = reflectionStmt.get(key)
      return row ? reflectionView(row) : { periodKey: key, content: '', updatedAt: '' }
    },

    getSetting(keyInput) {
      const key = String(keyInput || '').trim()
      if (!key) return ''
      const row = settingStmt.get(key)
      return row ? String(row.value || '') : ''
    },

    setSetting(keyInput, valueInput) {
      const key = String(keyInput || '').trim()
      if (!key) throw new Error('设置项不能为空')
      const value = String(valueInput === undefined || valueInput === null ? '' : valueInput)
      settingUpsertStmt.run(key, value, nowIso())
      return value
    },

    saveReflection(periodKey, content) {
      const key = cleanPeriod(periodKey)
      reflectionUpsertStmt.run(key, cleanText(content, MAX_NOTE), nowIso())
      return reflectionView(reflectionStmt.get(key))
    },

    pomodoroRange(fromInput, toInput) {
      let from = isDate(fromInput) ? fromInput : localDay()
      let to = isDate(toInput) ? toInput : from
      if (from > to) {
        const swap = from
        from = to
        to = swap
      }
      const start = new Date(from + 'T00:00:00')
      const end = new Date(to + 'T00:00:00')
      const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
      if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 366) {
        throw new Error('统计范围不合法')
      }
      const rows = sessionsByRangeStmt.all(from, to).map(sessionView)
      const taskMap = new Map()
      let seconds = 0
      let tomatoes = 0
      for (const item of rows) {
        seconds += item.durationSeconds
        if (item.completed) tomatoes += 1
        const key = String(item.taskId)
        const entry = taskMap.get(key) || {
          taskId: item.taskId,
          title: item.taskTitle || '已删除任务',
          seconds: 0,
          tomatoes: 0,
          sessions: 0,
        }
        entry.seconds += item.durationSeconds
        entry.sessions += 1
        if (item.completed) entry.tomatoes += 1
        taskMap.set(key, entry)
      }
      const days = []
      const dayIndex = new Map()
      for (let offset = 0; offset < dayCount; offset += 1) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
        const item = { date: localDay(date), tomatoes: 0, seconds: 0, sessions: 0 }
        days.push(item)
        dayIndex.set(item.date, item)
      }
      for (const row of rows) {
        const item = dayIndex.get(row.day)
        if (!item) continue
        item.seconds += row.durationSeconds
        item.sessions += 1
        if (row.completed) item.tomatoes += 1
      }
      return {
        from,
        to,
        totals: { sessions: rows.length, seconds, tomatoes },
        tasks: Array.from(taskMap.values()).sort((a, b) => b.seconds - a.seconds || b.tomatoes - a.tomatoes),
        days,
      }
    },

    pomodoroStats(dayInput) {
      const day = isDate(dayInput) ? dayInput : localDay()
      const rows = sessionsByDayStmt.all(day).map(sessionView)
      const taskMap = new Map()
      let seconds = 0
      let tomatoes = 0
      for (const item of rows) {
        seconds += item.durationSeconds
        if (item.completed) tomatoes += 1
        const key = String(item.taskId)
        const entry = taskMap.get(key) || {
          taskId: item.taskId,
          title: item.taskTitle || '已删除任务',
          seconds: 0,
          tomatoes: 0,
          sessions: 0,
        }
        entry.seconds += item.durationSeconds
        entry.sessions += 1
        if (item.completed) entry.tomatoes += 1
        taskMap.set(key, entry)
      }
      const start = new Date(day + 'T00:00:00')
      const days = []
      for (let offset = 6; offset >= 0; offset -= 1) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() - offset)
        days.push({ date: localDay(date), tomatoes: 0, seconds: 0, sessions: 0 })
      }
      const dayIndex = new Map(days.map((item) => [item.date, item]))
      for (const row of sessionsByRangeStmt.all(days[0].date, day)) {
        const item = dayIndex.get(String(row.day))
        if (!item) continue
        item.seconds += Number(row.duration_seconds) || 0
        item.sessions += 1
        if (Number(row.completed)) item.tomatoes += 1
      }
      return {
        date: day,
        totals: { sessions: rows.length, seconds, tomatoes },
        tasks: Array.from(taskMap.values()).sort((a, b) => b.seconds - a.seconds || b.tomatoes - a.tomatoes),
        sessions: rows,
        days,
      }
    },

    close() {
      try {
        db.close()
      } catch {
        /* already closed */
      }
    },
  }
}
