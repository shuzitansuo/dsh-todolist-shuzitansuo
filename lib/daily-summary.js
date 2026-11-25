/**
 * 生成写入 Obsidian 的当天总结（本地规则，不调用外部模型）。
 * 输入为当天的任务、全部任务、番茄统计和当天感想。
 */

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.round(total / 60)
  if (minutes < 1) return '0 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${minutes} 分钟`
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim() || '未命名任务'
}

function isDropped(task) {
  return ['dropped', 'pause', 'cancel'].includes(String(task.status || ''))
}

function taskOrder(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1
  const at = a.startTime === null || a.startTime === undefined ? 24 * 60 : Number(a.startTime)
  const bt = b.startTime === null || b.startTime === undefined ? 24 * 60 : Number(b.startTime)
  if (at !== bt) return at - bt
  return Number(a.id) - Number(b.id)
}

function quoteLines(text) {
  return String(text || '')
    .trim()
    .split(/\r?\n/)
    .map((line) => (line ? '> ' + line : '>'))
    .join('\n')
}

export function buildDailyReview({ tasks = [], allTasks = [], pomodoro = null, day }) {
  const today = tasks.filter((task) => !isDropped(task)).sort(taskOrder)
  const done = today.filter((task) => task.done).length
  const total = today.length
  const open = total - done
  const rate = total ? Math.round((done / total) * 100) : 0
  const seconds = Number(pomodoro && pomodoro.totals ? pomodoro.totals.seconds : 0) || 0
  const tomatoes = Number(pomodoro && pomodoro.totals ? pomodoro.totals.tomatoes : 0) || 0
  const sessions = Number(pomodoro && pomodoro.totals ? pomodoro.totals.sessions : 0) || 0
  const focus = formatDuration(seconds)
  const overdue = allTasks.filter(
    (task) => !task.done && !isDropped(task) && task.deadline && task.deadline < day,
  ).length
  const p1Open = today.filter((task) => !task.done && Number(task.priority) === 1)
  const dropped = allTasks.filter((task) => task.deadline === day && isDropped(task)).length
  const finished = today.filter((task) => task.done)

  const overview = []
  if (!total) {
    overview.push('今天没有安排任务。' + (seconds > 0
      ? `不过仍完成了 ${focus} 的专注，注意力有落在具体事情上。`
      : '把节奏放慢、给自己留出空白，也是一种安排。'))
    if (overdue > 0) overview.push(`另有 ${overdue} 项逾期未完成，可以先挑一项影响最大的处理。`)
  } else {
    overview.push(`今天共安排 ${total} 项任务，完成 ${done} 项，完成率 ${rate}%。`)
    if (done === total) overview.push('所有任务都收尾了，节奏很完整。')
    else if (done > 0) overview.push('推进是稳定的，先把已经完成的成果留下来。')
    else overview.push('任务还在启动阶段，先完成最小的一步，比一次做完更重要。')
    if (seconds > 0) overview.push(`同时投入 ${focus}，完成 ${tomatoes} 个番茄。`)
    else overview.push('今天还没有专注记录，明天可以先从一个 25 分钟的小块开始。')
    if (overdue > 0) overview.push(`另有 ${overdue} 项逾期未完成，建议先处理影响最大的一项。`)
  }

  const keep = []
  if (finished.length) {
    const names = finished.slice(0, 3).map((task) => `「${cleanTitle(task.title)}」`)
    keep.push(`完成了${names.join('、')}${finished.length > 3 ? ' 等任务' : ''}，成果已经落地。`)
  }
  if (seconds > 0) {
    keep.push(`累计专注 ${focus}${tomatoes ? `，完成 ${tomatoes} 个番茄` : ''}，注意力有明确的投入。`)
  }
  if (dropped > 0) keep.push(`主动放弃 ${dropped} 项，把注意力留给了更重要的事。`)
  if (!keep.length) keep.push('今天暂时没有明显可保持的成果，保留清单本身就是下一次复盘的起点。')

  const improve = []
  if (open > 0) {
    improve.push(`还有 ${open} 项未完成${p1Open.length ? `，其中 P1 有 ${p1Open.length} 项` : ''}，建议先锁定最重要的一项。`)
  }
  if (total && rate < 50) improve.push(`完成率 ${rate}%，任务颗粒度可能偏大，明天可以拆成 30 分钟内可完成的小步。`)
  if (!seconds) improve.push('今天没有番茄记录，明天可以先设一个 25 分钟的最小专注。')
  if (overdue > 0) improve.push(`有 ${overdue} 项已经逾期，先处理最影响交付的一项，避免继续累积。`)
  if (!improve.length) improve.push('今天完成度很好，复盘时把有效的做法记下来，方便复用。')

  const next = today.filter((task) => !task.done).sort((a, b) => {
    const ap = Number(a.priority) || 3
    const bp = Number(b.priority) || 3
    if (ap !== bp) return ap - bp
    return taskOrder(a, b)
  })[0]
  const start = next
    ? `明天先从「${cleanTitle(next.title)}」开始，先做 25 分钟，再决定下一步。`
    : overdue > 0
      ? '明天先清理一项逾期任务，把积压减到可控范围。'
      : '明天开始前，先写下一件最重要的事，再安排其他内容。'

  const stop = []
  if (open >= 3) stop.push(`同时推进 ${open} 项容易分散，明天减少并行，一次只保留一个主线。`)
  if (tomatoes >= 4) stop.push('连续完成多个番茄后，安排一次离开屏幕的休息，避免后半程效率下降。')
  if (!seconds && total > 0) stop.push('避免一整天在任务之间来回切换，先锁定一个不被打断的时间段。')
  if (!stop.length) stop.push('暂时没有需要停止的习惯，保持当前节奏。')

  return {
    day,
    total,
    done,
    open,
    rate,
    seconds,
    tomatoes,
    sessions,
    overdue,
    dropped,
    focus,
    overview: overview.join(''),
    keep,
    improve,
    start,
    stop,
  }
}

export function dailySummaryLines({ day, tasks = [], allTasks = [], pomodoro = null, reflection = '' }) {
  const review = buildDailyReview({ tasks, allTasks, pomodoro, day })
  const lines = [
    `- 专注：${review.focus} · ${review.tomatoes} 个番茄`,
    review.total ? `- 任务：${review.done}/${review.total} 完成（${review.rate}%）` : '- 任务：今天没有安排任务',
  ]
  if (review.dropped) lines.push(`- 已放弃：${review.dropped} 项`)
  if (review.overdue) lines.push(`- 逾期未完成：${review.overdue} 项`)
  lines.push(
    '',
    '### AI 复盘',
    '',
    review.overview,
    '',
    '**K 保持**',
    ...review.keep.map((item) => `- ${item}`),
    '',
    '**I 改进**',
    ...review.improve.map((item) => `- ${item}`),
    '',
    '**S 开始**',
    `- ${review.start}`,
    '',
    '**T 停止**',
    ...review.stop.map((item) => `- ${item}`),
    '',
    '### 我的感想',
    '',
  )
  const text = String(reflection || '').trim()
  lines.push(text ? quoteLines(text) : '（今天还没有填写感想）')
  return lines
}

export function formatFocusDuration(seconds) {
  return formatDuration(seconds)
}
