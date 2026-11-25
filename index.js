/**
 * dsh-calendar — 宿主端。
 *
 * 打开 `$DSH_HOME/calendar/db/calendar.sqlite`，在 `/calendar/api` 上提供任务
 * CRUD。没有外部 HTTP，日历数据只在本机。
 */

import { calendarPaths } from './lib/paths.js'
import { openCalendar } from './lib/store.js'
import { API_PREFIX, createCalendarHandler } from './lib/api.js'

export const name = 'dsh-calendar'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dataDir?: string }} [config]
 */
export function apply(ctx, config = {}) {
  let paths
  try {
    paths = calendarPaths(config.dataDir ? { home: config.dataDir } : {})
  } catch (error) {
    console.error('calendar: cannot create the data directory:', error)
    return
  }

  let store
  try {
    store = openCalendar(paths.dbFile)
  } catch (error) {
    console.error('calendar: cannot open the database:', error)
    return
  }

  const handler = createCalendarHandler(store, () => paths.dbFile, paths.home)

  ctx.effect(() => () => store.close(), 'calendar: sqlite')

  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler,
      }),
      'calendar: local api',
    )
  })
}
