window.__ModuleLoader__.load({
  id: '@local/dsh-calendar',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const APP_VERSION = '0.2.2';
    const HEADERS = { 'x-calendar-client': '1' };
    const ORDER_KEY = 'dsh-calendar-task-order-v1';
    const TIMES_KEY = 'dsh-calendar-task-times-v1';
    const DONE_KEY = 'dsh-calendar-show-done-v1';
    const NONWORK_KEY = 'dsh-calendar-show-nonwork-v1';
    const TASK_COLS_KEY = 'dsh-calendar-task-cols-v1';
    const COLLAPSED_GROUPS_KEY = 'dsh-calendar-collapsed-groups-v1';
    const DAY_DETAIL_W_KEY = 'dsh-calendar-day-detail-w-v1';
    const POMO_ACTIVE_KEY = 'dsh-calendar-pomodoro-active-v1';
    const POMO_PRESETS = [25, 30, 45];

    const DEFAULT_DAY_START_MIN = 8 * 60;
    const DEFAULT_DAY_END_MIN = 24 * 60;
    const DAY_SLOT_MIN = 30;
    const DAY_SNAP_MIN = 15;
    const DAY_HOUR_PX = 56;
    const DAY_PX_PER_MIN = DAY_HOUR_PX / 60;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const formatDuration = (seconds) => {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      if (total < 60) return total > 0 ? '不足 1 分钟' : '0 分钟';
      const minutes = Math.round(total / 60);
      if (minutes < 60) return minutes + ' 分钟';
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours + ' 小时' + (rest ? ' ' + rest + ' 分钟' : '');
    };
    const formatPomoClock = (seconds) => {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      return (hours ? String(hours).padStart(2, '0') + ':' : '') + pad2(minutes) + ':' + pad2(secs);
    };
    const loadPomoTimer = () => {
      try {
        const raw = JSON.parse(localStorage.getItem(POMO_ACTIVE_KEY) || 'null');
        if (!raw || !raw.taskId) return null;
        if (raw.mode !== 'countdown' && raw.mode !== 'countup') return null;
        const plannedSeconds = Math.max(0, Number(raw.plannedSeconds) || 0);
        if (raw.mode === 'countdown' && plannedSeconds < 60) return null;
        return {
          taskId: Number(raw.taskId),
          taskTitle: String(raw.taskTitle || ''),
          mode: raw.mode,
          plannedSeconds,
          elapsedMs: Math.max(0, Number(raw.elapsedMs) || 0),
          startedAt: 0,
          // 页面关闭期间不计时，恢复后保持暂停，避免第二天回来误记一个番茄。
          running: false,
          startIso: String(raw.startIso || new Date().toISOString()),
          day: String(raw.day || todayKey()),
        };
      } catch (error) {
        return null;
      }
    };
    const pad2 = (value) => String(value).padStart(2, '0');
    const dateKeyOf = (date) => date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());

    // 从快速添加的标题里识别自然语言日期，并把它从标题中移除。
    const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const cnNumber = (raw) => {
      if (/^\d+$/.test(raw)) return Number(raw);
      if (raw === '十') return 10;
      if (raw.includes('十')) {
        const parts = raw.split('十');
        const tens = parts[0] ? CN_DIGITS[parts[0]] : 1;
        const ones = parts[1] ? CN_DIGITS[parts[1]] : 0;
        return Number.isFinite(tens) && Number.isFinite(ones) ? tens * 10 + ones : NaN;
      }
      return CN_DIGITS[raw];
    };
    const CN_DATE_TOKEN = '([0-9]{1,2}|[一二两三四五六七八九十]{1,3})';
    const MONTH_DAY_RE = new RegExp(CN_DATE_TOKEN + '月' + CN_DATE_TOKEN + '[日号]');
    const WEEKDAY_CHARS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const RELATIVE_DAYS = { 大后天: 3, 后天: 2, 明天: 1, 明日: 1, 今天: 0, 今日: 0, 昨天: -1, 昨日: -1, 前天: -2 };

    const parseTaskDateText = (text, baseKey) => {
      const original = String(text || '').trim();
      let working = original
        .replace(/明晚/g, '明天晚上')
        .replace(/今晚/g, '今天晚上')
        .replace(/昨晚/g, '昨天晚上')
        .replace(/明早/g, '明天早上')
        .replace(/今早/g, '今天早上')
        .replace(/昨早/g, '昨天早上');
      const base = new Date((baseKey || todayKey()) + 'T00:00:00');
      let date = '';
      const makeDate = (year, month, day) => {
        const d = new Date(year, month - 1, day);
        if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
        return d;
      };
      const consume = (regex) => {
        const m = working.match(regex);
        if (!m) return null;
        working = (working.slice(0, m.index) + ' ' + working.slice(m.index + m[0].length)).trim();
        return m;
      };
      const setDate = (d) => {
        if (d && !date) date = dateKeyOf(d);
      };

      // 2026-11-26 / 2026/11/26
      const iso = consume(/([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})/);
      if (iso) setDate(makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3])));

      // 2026年11月26日
      if (!date) {
        const ymd = consume(/([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})[日号]/);
        if (ymd) setDate(makeDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])));
      }

      // 11月26日 / 十一月二十六号
      if (!date) {
        const md = consume(MONTH_DAY_RE);
        if (md) {
          const month = cnNumber(md[1]);
          const day = cnNumber(md[2]);
          if (Number.isFinite(month) && Number.isFinite(day)) {
            let d = makeDate(base.getFullYear(), month, day);
            if (d && d < base) d = makeDate(base.getFullYear() + 1, month, day);
            setDate(d);
          }
        }
      }

      // 周三 / 下周三 / 下个星期三 / 本周五
      if (!date) {
        const wd = consume(/(?:在\s*)?(下下|下个|下|这个|这|本)?(?:周|星期|礼拜)([一二三四五六日天])/);
        if (wd) {
          const prefix = wd[1] || '';
          const target = WEEKDAY_CHARS[wd[2]];
          const offsetFromMonday = base.getDay() === 0 ? 6 : base.getDay() - 1;
          const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offsetFromMonday);
          let d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + (target === 0 ? 6 : target - 1));
          if (prefix.startsWith('下')) {
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (prefix === '下下' ? 14 : 7));
          } else if (!prefix && d < base) {
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
          }
          setDate(d);
        }
      }

      // 今天 / 明天 / 后天 / 昨天
      if (!date) {
        const rel = consume(/(?:在\s*)?(大后天|后天|明天|明日|今天|今日|昨天|昨日|前天)/);
        if (rel) {
          const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + RELATIVE_DAYS[rel[1]]);
          setDate(d);
        }
      }

      // 3天后 / 三天后
      if (!date) {
        const after = consume(/([0-9]+|[一二两三四五六七八九十]{1,3})天后/);
        if (after) {
          const days = cnNumber(after[1]);
          if (Number.isFinite(days)) {
            setDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
          }
        }
      }

      let title = working
        .replace(/[（(【\[]\s*[）)】\]]/g, ' ')
        .replace(/^[\s,，。、;；:：\-—]+/, '')
        .replace(/[\s,，。、;；:：\-—]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!title) title = original;
      return { title, date };
    };

    const TIME_PERIOD_PATTERN = '凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜间';
    // 从快速添加的标题里识别自然语言时间，并把它从标题中移除。
    const parseTaskTimeText = (text) => {
      const original = String(text || '').trim();
      let working = original;
      let startTime = null;
      const periodHour = (hour, period) => {
        if (period === '凌晨') return hour === 12 ? 0 : hour;
        if (period === '中午') return hour < 11 ? hour + 12 : hour;
        if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里' || period === '夜间') {
          if (hour === 12) return 0;
          return hour < 12 ? hour + 12 : hour;
        }
        return hour;
      };
      const takeTime = (regex, hourIndex, minuteIndex, periodIndex, suffixIndex) => {
        const before = working;
        const m = working.match(regex);
        if (!m) return false;
        const rawHour = m[hourIndex];
        const rawMinute = minuteIndex == null ? '' : m[minuteIndex] || '';
        const period = periodIndex == null ? '' : m[periodIndex] || '';
        let hour = /^[0-9]+$/.test(rawHour) ? Number(rawHour) : cnNumber(rawHour);
        let minute = 0;
        if (suffixIndex != null) {
          const suffix = m[suffixIndex] || '';
          if (suffix === '半') minute = 30;
          else if (suffix === '一刻') minute = 15;
          else if (suffix === '三刻') minute = 45;
          else if (suffix === '整') minute = 0;
          else if (suffix) {
            const numeric = suffix.match(/[0-9]{1,2}/);
            if (numeric) minute = Number(numeric[0]);
          }
        } else if (rawMinute) {
          minute = Number(rawMinute);
        }
        // 「一点建议」这类不是时间，避免误删标题。
        if (!period && rawHour === '一' && !m[suffixIndex] && !rawMinute) {
          working = before;
          return false;
        }
        if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
          working = before;
          return false;
        }
        hour = periodHour(hour, period);
        if (hour < 0 || hour > 23) {
          working = before;
          return false;
        }
        working = (working.slice(0, m.index) + ' ' + working.slice(m.index + m[0].length)).trim();
        startTime = hour * 60 + minute;
        return true;
      };

      // 9:30 / 下午 3:05 / 21:00
      const colonRe = new RegExp('(?:在\\s*)?(' + TIME_PERIOD_PATTERN + ')?\\s*([0-9]{1,2})\\s*[:：]\\s*([0-9]{1,2})');
      let matched = takeTime(colonRe, 2, 3, 1, null);
      // 上午9点 / 下午3点半 / 晚上8点15分 / 九点一刻
      if (!matched) {
        const pointRe = new RegExp(
          '(?:在\\s*)?(' + TIME_PERIOD_PATTERN + ')?\\s*([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\\s*(?:点|时)(?:\\s*(半|一刻|三刻|整|([0-9]{1,2})\\s*分?))?',
        );
        matched = takeTime(pointRe, 2, null, 1, 3);
      }

      let title = working
        .replace(/[（(【\[]\s*[）)】\]]/g, ' ')
        .replace(/^[\s,，。、;；:：\-—]+/, '')
        .replace(/[\s,，。、;；:：\-—]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!title) title = original;
      return { title, startTime };
    };
    const todayKey = () => dateKeyOf(new Date());
    const matrixQuadrantOf = (task, today = todayKey()) => {
      const manual = Number(task.quadrant);
      if ([1, 2, 3, 4].includes(manual)) return 'q' + manual;
      const important = (Number(task.priority) || 3) <= 2;
      const urgent = Boolean(task.deadline) && task.deadline <= today;
      return important ? (urgent ? 'q1' : 'q2') : urgent ? 'q3' : 'q4';
    };
    const SUMMARY_MODES = [
      { key: 'day', label: '日总结', unit: '天' },
      { key: 'week', label: '周总结', unit: '周' },
      { key: 'month', label: '月总结', unit: '月' },
    ];
    const SKINS = [
      { id: 'blue', label: '经典蓝', color: '#2f7cf6', deep: '#245fd6' },
      { id: 'teal', label: '松石绿', color: '#0f9f8f', deep: '#0a7a6e' },
      { id: 'violet', label: '紫罗兰', color: '#7c5cff', deep: '#6245d8' },
      { id: 'coral', label: '珊瑚橙', color: '#f26b3f', deep: '#d4532c' },
      { id: 'rose', label: '玫瑰红', color: '#e5457a', deep: '#c52f62' },
      { id: 'graphite', label: '石墨灰', color: '#556070', deep: '#3f4855' },
    ];
    const SKIN_BY_ID = SKINS.reduce((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
    const hexRgb = (hex) => {
      const value = String(hex || '').replace('#', '');
      return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) || 0);
    };
    const mixHex = (hex, target, ratio) => {
      const a = hexRgb(hex);
      const b = hexRgb(target);
      const t = clamp(Number(ratio) || 0, 0, 1);
      return '#' + a.map((value, index) => Math.round(value + (b[index] - value) * t).toString(16).padStart(2, '0')).join('');
    };
    const CATEGORY_FALLBACK_COLOR = '#9aa3ad'
    const alphaColor = (hex, alpha) => {
      const rgb = hexRgb(hex)
      return 'rgba(' + rgb.join(',') + ',' + clamp(Number(alpha) || 0, 0, 1) + ')'
    }
    const taskCategoryColor = (task) =>
      task && /^#[0-9a-fA-F]{6}$/.test(String(task.categoryColor || ''))
        ? String(task.categoryColor)
        : CATEGORY_FALLBACK_COLOR
    const taskCategoryStyle = (task) => {
      const color = taskCategoryColor(task)
      return {
        '--lc-cat': color,
        '--lc-cat-bg': alphaColor(color, 0.09),
        '--lc-cat-line': alphaColor(color, 0.55),
      }
    }
    const skinStyle = (value) => {
      const skin = SKIN_BY_ID[value] || SKINS[0];
      const rgb = hexRgb(skin.color).join(',');
      return {
        '--lc-brand': skin.color,
        '--lc-brand-deep': skin.deep,
        '--lc-brand-light': mixHex(skin.color, '#ffffff', 0.38),
        '--lc-brand-soft': mixHex(skin.color, '#ffffff', 0.9),
        '--lc-brand-rgb': rgb,
        '--td-brand-color': skin.color,
        '--td-brand-color-hover': mixHex(skin.color, '#ffffff', 0.14),
        '--td-brand-color-focus': 'rgba(' + rgb + ',.24)',
        '--td-brand-color-active': skin.deep,
        '--td-brand-color-disabled': 'rgba(' + rgb + ',.35)',
        '--td-brand-color-light': 'rgba(' + rgb + ',.1)',
        '--td-brand-color-light-hover': 'rgba(' + rgb + ',.2)',
        '--td-text-color-brand': skin.color,
      };
    };
    const TASK_THEMES = [
      { name: '设计与体验', words: ['设计', '页面', '首页', '交互', '视觉', '原型', '样式', 'ui', 'ux', '体验'] },
      { name: '写作与汇报', words: ['周报', '日报', '汇报', '总结', '文档', '方案', '报告', '稿'] },
      { name: '数据与分析', words: ['数据', '分析', '指标', '报表', '复盘', '盘点', '统计', '看板'] },
      { name: '研发与交付', words: ['开发', '修复', 'bug', '接口', '上线', '发布', '测试', '联调', '部署'] },
      { name: '沟通与协作', words: ['会议', '沟通', '对齐', '同步', '讨论', '协作', '分享', '演讲'] },
      { name: '运营与内容', words: ['运营', '内容', '公众号', '活动', '用户', '增长', '投放'] },
      { name: '学习与成长', words: ['面试', '学习', '课程', '阅读', '练习', '考试', '笔记'] },
      { name: '需求与产品', words: ['需求', '产品', '优先级', '版本', '功能', '迭代', '规划', '排期'] },
    ];
    const pickTaskTheme = (text) => {
      const value = String(text || '').toLowerCase();
      if (!value.trim()) return '';
      for (let i = 0; i < TASK_THEMES.length; i += 1) {
        const words = TASK_THEMES[i].words;
        for (let j = 0; j < words.length; j += 1) {
          if (value.indexOf(words[j]) >= 0) return TASK_THEMES[i].name;
        }
      }
      return '';
    };
    const taskThemeOf = (task) => {
      const title = task && task.title ? task.title : '';
      const fromTitle = pickTaskTheme(title);
      if (fromTitle) return fromTitle;
      const fromDescription = task && task.description ? pickTaskTheme(task.description) : '';
      return fromDescription || '其他';
    };
    const groupTasksByTheme = (tasks) => {
      const map = new Map();
      tasks.forEach((task) => {
        const theme = taskThemeOf(task);
        if (!map.has(theme)) map.set(theme, []);
        map.get(theme).push(task);
      });
      return Array.from(map, ([theme, list]) => ({ theme, list })).sort(
        (a, b) => b.list.length - a.list.length,
      );
    };
    const summaryPeriod = (mode, anchorKey) => {
      const base = new Date((anchorKey || todayKey()) + 'T00:00:00');
      const safe = Number.isNaN(base.getTime()) ? new Date() : base;
      const year = safe.getFullYear();
      const month = safe.getMonth();
      const day = safe.getDate();
      let start;
      let end;
      if (mode === 'day') {
        start = new Date(year, month, day);
        end = new Date(year, month, day);
      } else if (mode === 'month') {
        start = new Date(year, month, 1);
        end = new Date(year, month + 1, 0);
      } else {
        const offset = (safe.getDay() + 6) % 7;
        start = new Date(year, month, day - offset);
        end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      }
      const days = [];
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      while (cursor <= end) {
        days.push(dateKeyOf(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      return { startKey: dateKeyOf(start), endKey: dateKeyOf(end), days };
    };
    const clockText = (minutes) => {
      const total = Math.max(0, Math.min(24 * 60, Math.round(Number(minutes) || 0)));
      return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
    };

    const STATUS_OPTIONS = [
      { value: 'wait', label: '未开始' },
      { value: 'doing', label: '进行中' },
      { value: 'done', label: '已完成' },
      { value: 'dropped', label: '已放弃' },
    ];
    const CAL_STATUS_OPTIONS = [{ value: 'dropped', label: '放弃' }];
    const BOARD_COLUMNS = [
      { key: 'wait', label: '未开始', color: '#8f9aa8', empty: '还没有待办任务' },
      { key: 'doing', label: '进行中', color: '#2f7cf6', empty: '还没有进行中的任务' },
      { key: 'done', label: '已完成', color: '#2ba471', empty: '还没有已完成任务' },
    ];

    const DROPPED_STATUSES = ['dropped', 'pause', 'cancel'];
    const isDroppedStatus = (status) => DROPPED_STATUSES.includes(status);
    const pomodoroBlock = (task) => {
      if (!task) return null;
      if (Boolean(task.done) || task.status === 'done') {
        return { title: '已完成的任务不能开始番茄钟', label: '已完成，不能开始' };
      }
      if (isDroppedStatus(task.status)) {
        return { title: '已放弃的任务不能开始番茄钟', label: '已放弃，不能开始' };
      }
      return null;
    };
    const statusLabelOf = (task) =>
      isDroppedStatus(task.status) ? '已放弃' : task.statusText || task.status || '未开始';

    const TASK_FILTERS = [
      { key: 'today', label: '今天', icon: 'sun' },
      { key: 'tomorrow', label: '明天', icon: 'calendar' },
      { key: 'next7', label: '最近 7 天', icon: 'calendar' },
      { key: 'inbox', label: '收集箱', icon: 'inbox' },
      { key: 'done', label: '已完成', icon: 'check-circle' },
    ];

    function statusTone(status) {
      const map = {
        doing: 'primary',
        wait: 'default',
        done: 'success',
        dropped: 'default',
        pause: 'default',
        cancel: 'default',
      };
      return map[status] || 'default';
    }

    // ── Markdown 渲染（标题/列表/引用/代码/加粗等，供任务详情直接显示）──────
    function renderInlineMarkdown(text, prefix) {
      const nodes = [];
      let buffer = '';
      let index = 0;
      let key = 0;
      const flush = () => {
        if (buffer) {
          nodes.push(buffer);
          buffer = '';
        }
      };
      while (index < text.length) {
        const ch = text[index];
        if (ch === '`') {
          const end = text.indexOf('`', index + 1);
          if (end > index + 1) {
            flush();
            nodes.push(h('code', { key: prefix + '-c' + key++ }, text.slice(index + 1, end)));
            index = end + 1;
            continue;
          }
        }
        if (text.startsWith('**', index) || text.startsWith('__', index)) {
          const mark = text.slice(index, index + 2);
          const end = text.indexOf(mark, index + 2);
          if (end > index + 2) {
            flush();
            nodes.push(h('strong', { key: prefix + '-b' + key++ }, renderInlineMarkdown(text.slice(index + 2, end), prefix + '-b' + key)));
            index = end + 2;
            continue;
          }
        }
        if (text.startsWith('~~', index)) {
          const end = text.indexOf('~~', index + 2);
          if (end > index + 2) {
            flush();
            nodes.push(h('del', { key: prefix + '-d' + key++ }, text.slice(index + 2, end)));
            index = end + 2;
            continue;
          }
        }
        if (ch === '*' || ch === '_') {
          const end = text.indexOf(ch, index + 1);
          if (end > index + 1 && text[index + 1] !== ' ') {
            flush();
            nodes.push(h('em', { key: prefix + '-e' + key++ }, renderInlineMarkdown(text.slice(index + 1, end), prefix + '-e' + key)));
            index = end + 1;
            continue;
          }
        }
        if (ch === '[') {
          const link = text.slice(index).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
          if (link) {
            flush();
            const href = /^(https?:|mailto:|#|\/)/i.test(link[2]) ? link[2] : '#';
            nodes.push(h('a', { key: prefix + '-a' + key++, href, target: '_blank', rel: 'noreferrer' }, link[1]));
            index += link[0].length;
            continue;
          }
        }
        buffer += ch;
        index += 1;
      }
      flush();
      return nodes;
    }

    function renderMarkdown(source) {
      const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
      const blocks = [];
      let index = 0;
      let key = 0;
      const isBlockStart = (line) =>
        /^(#{1,4}\s|```|>\s?|[-*+]\s+|\d+\.\s+)/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line);
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
          index += 1;
          continue;
        }
        if (/^```/.test(line)) {
          index += 1;
          const code = [];
          while (index < lines.length && !/^```/.test(lines[index])) {
            code.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          blocks.push(h('pre', { key: 'b' + key++ }, h('code', null, code.join('\n'))));
          continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
          const tag = 'h' + heading[1].length;
          blocks.push(h(tag, { key: 'b' + key++ }, renderInlineMarkdown(heading[2], 'h' + key)));
          index += 1;
          continue;
        }
        if (/^>\s?/.test(line)) {
          const quote = [];
          while (index < lines.length && /^>\s?/.test(lines[index])) {
            quote.push(lines[index].replace(/^>\s?/, ''));
            index += 1;
          }
          blocks.push(h('blockquote', { key: 'b' + key++ }, renderMarkdown(quote.join('\n'))));
          continue;
        }
        if (/^[-*+]\s+/.test(line)) {
          const items = [];
          while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
            items.push(lines[index].replace(/^[-*+]\s+/, ''));
            index += 1;
          }
          blocks.push(
            h(
              'ul',
              { key: 'b' + key++ },
              items.map((item, itemIndex) => {
                const check = item.match(/^\[([ xX])\]\s+(.*)$/);
                if (check) {
                  return h(
                    'li',
                    { key: itemIndex, className: 'lc-md-check' },
                    h('input', { type: 'checkbox', checked: check[1].toLowerCase() === 'x', readOnly: true }),
                    h('span', null, renderInlineMarkdown(check[2], 'li' + itemIndex)),
                  );
                }
                return h('li', { key: itemIndex }, renderInlineMarkdown(item, 'li' + itemIndex));
              }),
            ),
          );
          continue;
        }
        if (/^\d+\.\s+/.test(line)) {
          const items = [];
          while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
            items.push(lines[index].replace(/^\d+\.\s+/, ''));
            index += 1;
          }
          blocks.push(
            h(
              'ol',
              { key: 'b' + key++ },
              items.map((item, itemIndex) => h('li', { key: itemIndex }, renderInlineMarkdown(item, 'ol' + itemIndex))),
            ),
          );
          continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
          blocks.push(h('hr', { key: 'b' + key++ }));
          index += 1;
          continue;
        }
        const paragraph = [line];
        index += 1;
        while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
          paragraph.push(lines[index]);
          index += 1;
        }
        const children = [];
        paragraph.forEach((item, itemIndex) => {
          if (itemIndex) children.push(h('br', { key: 'br' + itemIndex }));
          children.push.apply(children, renderInlineMarkdown(item, 'p' + key + '-' + itemIndex));
        });
        blocks.push(h('p', { key: 'b' + key++ }, children));
      }
      return blocks.length ? blocks : null;
    }

    function readBool(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : raw === '1';
      } catch (error) {
        return fallback;
      }
    }

    function writeBool(key, value) {
      try {
        localStorage.setItem(key, value ? '1' : '0');
      } catch (error) {
        /* storage unavailable */
      }
    }

    function loadOrderMap() {
      try {
        const raw = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      } catch (error) {
        return {};
      }
    }

    function loadTimeMap() {
      try {
        const raw = JSON.parse(localStorage.getItem(TIMES_KEY) || 'null');
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      } catch (error) {
        return {};
      }
    }

    async function api(path, options) {
      const opts = options || {};
      const res = await fetch(path, Object.assign({}, opts, {
        headers: Object.assign({}, HEADERS, opts.headers || {}),
      }));
      let data;
      try {
        data = await res.json();
      } catch (error) {
        throw new Error('接口返回异常（HTTP ' + res.status + '）');
      }
      if (!data.ok) throw new Error(data.error || '请求失败');
      return data;
    }

    // ── 图标（24 网格，1.8 描边，跟随 currentColor）──────────────────────────
    const GLYPH_PATHS = {
      'chevron-left': ['m15 18-6-6 6-6'],
      'chevron-right': ['m9 18 6-6-6-6'],
      'chevron-down': ['m6 9 6 6 6-6'],
      plus: ['M12 5v14', 'M5 12h14'],
      refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
      download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
      close: ['M18 6 6 18', 'm6 6 12 12'],
      check: ['M20 6 9 17l-5-5'],
      trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
      calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
      list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
      board: ['M4 5h16v14H4z', 'M9 5v14', 'M15 5v14'],
      book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
      inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
      sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
      'check-circle': ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm9 11 3 3L22 4'],
      chart: ['M3 3v18h18', 'M7 16v-5', 'M12 16V8', 'M17 16v-3'],
      timer: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
      sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z', 'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z'],
      grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
      edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
      settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'],
    };

    function TomatoMarks(props) {
      const count = Math.max(0, Number(props && props.count) || 0);
      if (!count) return null;
      const max = Number(props && props.max) || 5;
      const shown = Math.min(count, max);
      const extra = count - shown;
      return h(
        'span',
        { className: 'lc-tomato-marks' + (props && props.className ? ' ' + props.className : ''), title: count + ' 个番茄' },
        Array.from({ length: shown }, (_, index) => h('span', { key: index, className: 'lc-tomato' }, '🍅')),
        extra > 0 ? h('span', { className: 'lc-tomato-extra' }, '+' + extra) : null,
      );
    }

    function GlyphIcon(props) {
      const name = props.name;
      const size = Number(props.size) || 16;
      const paths = GLYPH_PATHS[name] || GLYPH_PATHS.calendar;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        paths.map((d, index) => h('path', { key: index, d })),
      );
    }

    // ── 农历 / 节气 / 法定节假日（2025-2027）────────────────────────────────
    // 农历 / 二十四节气（1900–2100 通用农历数据表 + 标准节气算法）
    const LUNAR_INFO = [
      0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
      0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
      0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
      0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
      0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
      0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573, 0x052d0, 0x0a9a8, 0x0e950, 0x06aa0,
      0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
      0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6,
      0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
      0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
      0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
      0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
      0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
      0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
      0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
      0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
      0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
      0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
      0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
      0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
      0x0d520,
    ];
    const lunarLeapMonth = (year) => LUNAR_INFO[year - 1900] & 0xf;
    const lunarLeapDays = (year) => (lunarLeapMonth(year) ? ((LUNAR_INFO[year - 1900] & 0x10000) ? 30 : 29) : 0);
    const lunarMonthDays = (year, month) => ((LUNAR_INFO[year - 1900] & (0x10000 >> month)) ? 30 : 29);
    const lunarYearDays = (year) => {
      let sum = 348;
      for (let bit = 0x8000; bit > 0x8; bit >>= 1) sum += LUNAR_INFO[year - 1900] & bit ? 1 : 0;
      return sum + lunarLeapDays(year);
    };
    const solarToLunar = (date) => {
      let offset = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1900, 0, 31)) / 86400000);
      let year = 1900;
      let temp = 0;
      for (; year < 2101 && offset > 0; year += 1) {
        temp = lunarYearDays(year);
        offset -= temp;
      }
      if (offset < 0) {
        offset += temp;
        year -= 1;
      }
      const leap = lunarLeapMonth(year);
      let isLeap = false;
      let month = 1;
      for (; month < 13 && offset > 0; month += 1) {
        if (leap > 0 && month === leap + 1 && !isLeap) {
          month -= 1;
          isLeap = true;
          temp = lunarLeapDays(year);
        } else {
          temp = lunarMonthDays(year, month);
        }
        if (isLeap && month === leap + 1) isLeap = false;
        offset -= temp;
      }
      if (offset === 0 && leap > 0 && month === leap + 1) {
        if (isLeap) {
          isLeap = false;
        } else {
          isLeap = true;
          month -= 1;
        }
      }
      if (offset < 0) {
        offset += temp;
        month -= 1;
      }
      return { year, month, day: offset + 1, isLeap };
    };
    const SOLAR_TERMS = [
      '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
      '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
    ];
    const SOLAR_TERM_INFO = [
      0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693,
      263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758,
    ];
    const solarTermOf = (date) => {
      const month = date.getMonth();
      for (const index of [month * 2, month * 2 + 1]) {
        const ms =
          31556925974.7 * (date.getFullYear() - 1900) +
          SOLAR_TERM_INFO[index] * 60000 +
          Date.UTC(1900, 0, 6, 2, 5);
        if (new Date(ms).getUTCDate() === date.getDate()) return SOLAR_TERMS[index];
      }
      return '';
    };
    const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
    const LUNAR_DAY_NAMES = (() => {
      const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
      const names = [];
      for (let day = 1; day <= 30; day += 1) {
        if (day === 10) names.push('初十');
        else if (day === 20) names.push('二十');
        else if (day === 30) names.push('三十');
        else if (day < 10) names.push('初' + digits[day - 1]);
        else if (day < 20) names.push('十' + digits[day - 11]);
        else names.push('廿' + digits[day - 21]);
      }
      return names;
    })();
    // 农历日期与节日按香港天文台《公历与农历对照表》核对（1901-2100）：
    // https://www.hko.gov.hk/sc/gts/time/conversion.htm
    // 2025-2027 的春节、元宵、清明、端午、中秋等已逐项对照 HKO 年历 PDF。
    const LUNAR_FESTIVALS = {
      '1-1': '春节',
      '1-15': '元宵节',
      '2-2': '龙抬头',
      '3-3': '上巳节',
      '5-5': '端午节',
      '7-7': '七夕',
      '7-15': '中元节',
      '8-15': '中秋节',
      '9-9': '重阳节',
      '10-1': '寒衣节',
      '10-15': '下元节',
      '12-8': '腊八节',
      '12-23': '小年·北',
      '12-24': '小年·南',
    };
    const lunarLabelOf = (date) => {
      const lunar = solarToLunar(date);
      if (!lunar.isLeap) {
        const festival = LUNAR_FESTIVALS[lunar.month + '-' + lunar.day];
        if (festival) return { text: festival, type: 'festival' };
      }
      // 除夕：农历腊月最后一天（次日为正月初一）
      const next = new Date(date);
      next.setDate(date.getDate() + 1);
      const nextLunar = solarToLunar(next);
      if (nextLunar.month === 1 && nextLunar.day === 1) return { text: '除夕', type: 'festival' };
      const term = solarTermOf(date);
      if (term === '清明') return { text: '清明节', type: 'festival' };
      if (term === '冬至') return { text: '冬至', type: 'festival' };
      // 寒食在清明前一日；先判断次日节气，避免被普通节气标签覆盖。
      if (solarTermOf(next) === '清明') return { text: '寒食节', type: 'festival' };
      if (term) return { text: term, type: 'term' };
      if (lunar.day === 1) {
        return { text: (lunar.isLeap ? '闰' : '') + LUNAR_MONTH_NAMES[lunar.month - 1] + '月', type: 'lunar' };
      }
      return { text: LUNAR_DAY_NAMES[lunar.day - 1], type: 'lunar' };
    };

    // 中国法定节假日调休标记：休 = 放假，班 = 补班（2025-2026 国务院办公厅安排）
    const CN_DAY_TAGS = (() => {
      const tags = {};
      const keyOf = (date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const range = (start, end, tag) => {
        const cursor = new Date(start + 'T00:00:00');
        const stop = new Date(end + 'T00:00:00');
        while (cursor <= stop) {
          tags[keyOf(cursor)] = tag;
          cursor.setDate(cursor.getDate() + 1);
        }
      };
      const day = (date, tag) => {
        tags[date] = tag;
      };
      // 2025
      day('2025-01-01', '休');
      range('2025-01-28', '2025-02-04', '休');
      day('2025-01-26', '班');
      day('2025-02-08', '班');
      range('2025-04-04', '2025-04-06', '休');
      range('2025-05-01', '2025-05-05', '休');
      day('2025-04-27', '班');
      range('2025-05-31', '2025-06-02', '休');
      range('2025-10-01', '2025-10-08', '休');
      day('2025-09-28', '班');
      day('2025-10-11', '班');
      // 2026
      range('2026-01-01', '2026-01-03', '休');
      day('2026-01-04', '班');
      range('2026-02-15', '2026-02-23', '休');
      day('2026-02-14', '班');
      day('2026-02-28', '班');
      range('2026-04-04', '2026-04-06', '休');
      range('2026-05-01', '2026-05-05', '休');
      day('2026-05-09', '班');
      range('2026-06-19', '2026-06-21', '休');
      range('2026-09-25', '2026-09-27', '休');
      range('2026-10-01', '2026-10-07', '休');
      day('2026-09-20', '班');
      day('2026-10-10', '班');
      // 2027（国办发明电〔2026〕10号）
      range('2027-01-01', '2027-01-03', '休');
      range('2027-02-05', '2027-02-13', '休');
      day('2027-01-31', '班');
      day('2027-02-14', '班');
      range('2027-04-03', '2027-04-05', '休');
      range('2027-05-01', '2027-05-05', '休');
      day('2027-05-08', '班');
      day('2027-06-09', '休');
      day('2027-09-15', '休');
      range('2027-10-01', '2027-10-07', '休');
      day('2027-09-26', '班');
      day('2027-10-09', '班');
      return tags;
    })();
    const cnDateKeyOf = (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const cnDayTagOf = (date) => CN_DAY_TAGS[cnDateKeyOf(date)] || '';
    const cnIsWeekendDay = (date) => date.getDay() === 0 || date.getDay() === 6;
    const cnIsMakeupWorkday = (date) => cnDayTagOf(date) === '班';
    const cnIsNonWorkday = (date) => {
      const tag = cnDayTagOf(date);
      if (tag === '班') return false;
      if (tag === '休') return true;
      return cnIsWeekendDay(date);
    };


    // ── 侧栏图标 ────────────────────────────────────────────────────────────
    function DroppedCross({ size = 13 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      );
    }

    function PanelButton(props) {
      const size = Number(props.size) || 18;
      return h(
        'span',
        {
          className: 'lc-panel-icon' + (props.active ? ' lc-panel-icon-active' : ''),
          title: '任务日历',
          'aria-hidden': true,
          style: {
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            color: 'currentColor',
          },
        },
        h(GlyphIcon, { name: 'calendar', size }),
      );
    }

    // ── 主页面 ──────────────────────────────────────────────────────────────
    function CalendarApp() {
      const [myTasks, setMyTasks] = useState({ loading: true, error: '', tasks: [] });
      const [categories, setCategories] = useState([]);
      const [categoriesLoading, setCategoriesLoading] = useState(true);
      const [categoriesError, setCategoriesError] = useState('');
      const [categoryDraft, setCategoryDraft] = useState({ name: '', color: '#2f7cf6' });
      const [categoryBusy, setCategoryBusy] = useState('');
      const [calendarMode, setCalendarMode] = useState('day');
      const [calendarMonth, setCalendarMonth] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
      });
      const [weekAnchor, setWeekAnchor] = useState(() => todayKey());
      const [selectedDate, setSelectedDate] = useState(() => todayKey());
      const [showDoneTasks, setShowDoneTasks] = useState(() => readBool(DONE_KEY, true));
      const [showNonWorkdays, setShowNonWorkdays] = useState(() => readBool(NONWORK_KEY, true));
      const [calendarTaskOrder, setCalendarTaskOrder] = useState(loadOrderMap);
      const [calendarDayTimes, setCalendarDayTimes] = useState(loadTimeMap);
      const [calendarStatusMenu, setCalendarStatusMenu] = useState(null);
      const [taskModal, setTaskModal] = useState(null);
      const [dayTaskId, setDayTaskId] = useState(null);
      const [matrixDetailOpen, setMatrixDetailOpen] = useState(false);
      const [dayDetail, setDayDetail] = useState(null);
      const [subtasks, setSubtasks] = useState({ taskId: null, loading: false, error: '', items: [] });
      const [subtaskDraft, setSubtaskDraft] = useState('');
      const [subtaskBusy, setSubtaskBusy] = useState(false);
      const subtaskSeqRef = useRef(0);
      const [descEditing, setDescEditing] = useState(false);
      const [descStatus, setDescStatus] = useState('');
      const descTimerRef = useRef(null);
      const descSeqRef = useRef(0);
      const descPendingRef = useRef(null);
      const [dayResize, setDayResize] = useState(null);
      const [dayNow, setDayNow] = useState(() => new Date());
      const [, setDayLayoutTick] = useState(0);
      const [completingTasks, setCompletingTasks] = useState([]);
      const [actionNotice, setActionNotice] = useState(null);
      const [updatePanel, setUpdatePanel] = useState(null);
      const [settingsReady, setSettingsReady] = useState(false);
      const [syncCalendar, setSyncCalendar] = useState(false);
      const [dayStartMin, setDayStartMin] = useState(DEFAULT_DAY_START_MIN);
      const [dayEndMin, setDayEndMin] = useState(DEFAULT_DAY_END_MIN);
      const [localEvents, setLocalEvents] = useState({ loading: false, error: '', events: [], calendars: [], syncedAt: '' });
      const localEventsSeqRef = useRef(0);
      const postTaskStatus = async (id, statusKey) => {
        try {
          return await api('/calendar/api/task-status', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, statusKey }),
          });
        } catch (error) {
          // 已放弃是合并后的新状态；旧版后端只认识 pause，先兼容一次。
          if (statusKey === 'dropped' && !/已完成/.test(error.message || '')) {
            return api('/calendar/api/task-status', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id, statusKey: 'pause' }),
            });
          }
          throw error;
        }
      };

      const [activeView, setActiveView] = useState('calendar');
      const [settingsSection, setSettingsSection] = useState('categories');
      const settingsDetailRef = useRef(null);
      const [obsidian, setObsidian] = useState({
        enabled: false,
        vault: '',
        heading: '## todo',
        intervalMinutes: 30,
        lastSyncAt: '',
        lastResult: '',
        lastError: '',
      });
      const [obsidianBusy, setObsidianBusy] = useState('');
      const [obsidianError, setObsidianError] = useState('');
      useEffect(() => {
        if (settingsDetailRef.current) settingsDetailRef.current.scrollTop = 0;
      }, [settingsSection]);
      useEffect(() => {
        let alive = true;
        api('/calendar/api/obsidian')
          .then((data) => {
            if (alive && data.obsidian) setObsidian(data.obsidian);
          })
          .catch((error) => {
            if (alive) setObsidianError(error.message);
          });
        return () => {
          alive = false;
        };
      }, []);
      useEffect(() => {
        if (!matrixDetailOpen) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          setMatrixDetailOpen(false);
          setDayTaskId(null);
          setDayDetail(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [matrixDetailOpen]);
      useEffect(() => {
        if (!dayTaskId) setMatrixDetailOpen(false);
      }, [dayTaskId]);
      useEffect(() => {
        if (activeView !== 'matrix' && activeView !== 'board') setMatrixDetailOpen(false);
      }, [activeView]);
      const [summaryMode, setSummaryMode] = useState('week');
      const [summaryAnchor, setSummaryAnchor] = useState(() => todayKey());
      const [summarySeed, setSummarySeed] = useState(0);
      const [summaryNote, setSummaryNote] = useState({
        periodKey: '',
        content: '',
        saved: '',
        loading: false,
        saving: false,
        error: '',
      });
      const [summaryFocus, setSummaryFocus] = useState({ loading: false, error: '', data: null });
      const [summaryFocusSeed, setSummaryFocusSeed] = useState(0);
      const summaryNoteTimer = useRef(null);
      const summaryNoteRef = useRef(null);

      useEffect(() => {
        if (activeView !== 'summary') return undefined;
        const key = summaryMode + ':' + summaryPeriod(summaryMode, summaryAnchor).startKey;
        let cancelled = false;
        setSummaryNote({ periodKey: key, content: '', saved: '', loading: true, saving: false, error: '' });
        api('/calendar/api/reflection?period=' + encodeURIComponent(key))
          .then((data) => {
            if (cancelled) return;
            const content = String((data.reflection && data.reflection.content) || '');
            setSummaryNote({ periodKey: key, content, saved: content, loading: false, saving: false, error: '' });
          })
          .catch((error) => {
            if (cancelled) return;
            setSummaryNote({
              periodKey: key,
              content: '',
              saved: '',
              loading: false,
              saving: false,
              error: error.message || '感想加载失败',
            });
          });
        return () => {
          cancelled = true;
        };
      }, [activeView, summaryMode, summaryAnchor]);

      useEffect(
        () => () => {
          if (summaryNoteTimer.current) clearTimeout(summaryNoteTimer.current);
        },
        [],
      );
      useEffect(() => {
        if (activeView !== 'summary') return undefined;
        const period = summaryPeriod(summaryMode, summaryAnchor);
        let cancelled = false;
        setSummaryFocus({ loading: true, error: '', data: null });
        api(
          '/calendar/api/pomodoro?from=' +
            encodeURIComponent(period.startKey) +
            '&to=' +
            encodeURIComponent(period.endKey),
        )
          .then((data) => {
            if (cancelled) return;
            setSummaryFocus({ loading: false, error: '', data: data.stats || null });
          })
          .catch((error) => {
            if (cancelled) return;
            setSummaryFocus({ loading: false, error: error.message || '番茄数据加载失败', data: null });
          });
        return () => {
          cancelled = true;
        };
      }, [activeView, summaryMode, summaryAnchor, summaryFocusSeed]);

      useEffect(() => {
        let cancelled = false;
        api('/calendar/api/settings')
          .then((data) => {
            if (cancelled) return;
            const settings = (data && data.settings) || {};
            setSyncCalendar(Boolean(settings.syncCalendar));
            const start = Number(settings.dayStart);
            const end = Number(settings.dayEnd);
            if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 * 60 && end - start >= 60) {
              setDayStartMin(start);
              setDayEndMin(end);
            }
            setSettingsReady(true);
          })
          .catch(() => {
            if (!cancelled) setSettingsReady(true);
          });
        return () => {
          cancelled = true;
        };
      }, []);

      const localEventRange = () => {
        if (calendarMode === 'day') return { from: selectedDate, to: selectedDate };
        if (calendarMode === 'month') {
          const year = calendarMonth.year;
          const month = calendarMonth.month;
          const first = new Date(year, month - 1, 1);
          const last = new Date(year, month, 0);
          return { from: dateKeyOf(first), to: dateKeyOf(last) };
        }
        const anchor = weekAnchor ? new Date(weekAnchor + 'T00:00:00') : new Date();
        const monday = new Date(anchor);
        monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return { from: dateKeyOf(monday), to: dateKeyOf(sunday) };
      };

      const loadLocalEvents = async (force = false, enabled = syncCalendar) => {
        if (!enabled) {
          setLocalEvents({ loading: false, error: '', events: [], calendars: [], syncedAt: '' });
          return;
        }
        const seq = ++localEventsSeqRef.current;
        setLocalEvents((prev) => Object.assign({}, prev, { loading: true, error: '' }));
        const range = localEventRange();
        try {
          const res = await api(
            '/calendar/api/local-events?from=' +
              encodeURIComponent(range.from) +
              '&to=' +
              encodeURIComponent(range.to) +
              (force ? '&force=1' : ''),
          );
          if (seq !== localEventsSeqRef.current) return;
          setLocalEvents({
            loading: false,
            error: res && res.error ? String(res.error) : '',
            events: (res && res.events) || [],
            calendars: (res && res.calendars) || [],
            syncedAt: (res && res.syncedAt) || '',
          });
        } catch (error) {
          if (seq !== localEventsSeqRef.current) return;
          setLocalEvents({ loading: false, error: error.message || '本机日历读取失败', events: [], calendars: [], syncedAt: '' });
        }
      };

      useEffect(() => {
        if (!syncCalendar) {
          setLocalEvents({ loading: false, error: '', events: [], calendars: [], syncedAt: '' });
          return;
        }
        if (activeView !== 'calendar') return;
        void loadLocalEvents(false, true);
      }, [syncCalendar, activeView, calendarMode, selectedDate, weekAnchor, calendarMonth.year, calendarMonth.month]);

      const saveSettings = async (patch) => {
        const res = await api('/calendar/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        return (res && res.settings) || {};
      };

      const toggleLocalCalendar = async () => {
        const next = !syncCalendar;
        setSyncCalendar(next);
        try {
          await saveSettings({ syncCalendar: next });
          if (next) void loadLocalEvents(true, true);
          else setLocalEvents({ loading: false, error: '', events: [], calendars: [], syncedAt: '' });
        } catch (error) {
          setSyncCalendar(!next);
          showNotice(error.message || '日历同步设置保存失败');
        }
      };

      const changeDayRange = async (nextStart, nextEnd) => {
        const start = Math.max(0, Math.min(24 * 60 - 60, Math.round(Number(nextStart) / 30) * 30));
        const end = Math.max(start + 60, Math.min(24 * 60, Math.round(Number(nextEnd) / 30) * 30));
        if (start === dayStartMin && end === dayEndMin) return;
        const previousStart = dayStartMin;
        const previousEnd = dayEndMin;
        setDayStartMin(start);
        setDayEndMin(end);
        try {
          const saved = await saveSettings({ dayStart: start, dayEnd: end });
          const savedStart = Number(saved.dayStart);
          const savedEnd = Number(saved.dayEnd);
          if (Number.isInteger(savedStart) && Number.isInteger(savedEnd)) {
            setDayStartMin(savedStart);
            setDayEndMin(savedEnd);
          }
        } catch (error) {
          setDayStartMin(previousStart);
          setDayEndMin(previousEnd);
          showNotice(error.message || '日视图时间保存失败');
        }
      };

      const [pomoSetup, setPomoSetup] = useState(null);
      const [pomoTimer, setPomoTimer] = useState(loadPomoTimer);
      const [pomoNow, setPomoNow] = useState(() => Date.now());
      const [pomoDay, setPomoDay] = useState(() => todayKey());
      const [pomoStats, setPomoStats] = useState({ loading: false, error: '', data: null });
      const [pomoCelebrate, setPomoCelebrate] = useState(null);
      const pomoFinishRef = useRef(false);
      const [taskFilter, setTaskFilter] = useState('today');
      const [taskCategoryId, setTaskCategoryId] = useState(null);
      const [boardDrag, setBoardDrag] = useState(null);
      const [boardOver, setBoardOver] = useState(null);
      const [boardBusyId, setBoardBusyId] = useState('');
      const boardDragRef = useRef(null);
      const boardDragEndRef = useRef(0);
      const [collapsedGroups, setCollapsedGroups] = useState(() => {
        try {
          const raw = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || 'null');
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const next = {};
            for (const [key, value] of Object.entries(raw)) if (value === true) next[key] = true;
            return next;
          }
        } catch (error) {
          /* ignore */
        }
        return {};
      });
      const expandTaskGroups = (keys) => {
        if (!keys || !keys.length) return;
        setCollapsedGroups((prev) => {
          let next = prev;
          for (const key of keys) {
            const name = key || '__nodate__';
            if (!next[name]) continue;
            if (next === prev) next = Object.assign({}, prev);
            delete next[name];
          }
          return next;
        });
      };
      const [taskCols, setTaskCols] = useState(() => {
        try {
          const raw = JSON.parse(localStorage.getItem(TASK_COLS_KEY) || 'null');
          if (raw && Number.isFinite(raw.side) && Number.isFinite(raw.detail)) {
            return { side: clamp(raw.side, 168, 320), detail: clamp(raw.detail, 300, 620) };
          }
        } catch (error) {
          /* ignore */
        }
        return { side: 220, detail: 380 };
      });
      const tasksWrapRef = useRef(null);
      const [dayDetailW, setDayDetailW] = useState(() => {
        try {
          const raw = Number(localStorage.getItem(DAY_DETAIL_W_KEY));
          if (Number.isFinite(raw) && raw > 0) return clamp(raw, 240, 520);
        } catch (error) {
          /* ignore */
        }
        return 300;
      });
      const dayViewRef = useRef(null);
      const rootRef = useRef(null);
      const [quickTitle, setQuickTitle] = useState('');
      const [quickSaving, setQuickSaving] = useState(false);
      const showNotice = (text, kind = 'error') => setActionNotice({ text, kind });

      const fetchUpdate = async (options = {}) => {
        setUpdatePanel((prev) =>
          prev
            ? Object.assign({}, prev, {
                loading: true,
                saving: Boolean(options.repo),
                error: '',
                editingRepo: Boolean(options.repo) ? false : prev.editingRepo,
                repoInput: options.repo || prev.repoInput,
              })
            : prev,
        );
        try {
          if (options.repo) {
            await api('/calendar/api/update-repo', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ repo: options.repo }),
            });
          }
          const res = await api('/calendar/api/update' + (options.force ? '?force=1' : ''));
          setUpdatePanel((prev) =>
            prev
              ? Object.assign({}, prev, {
                  loading: false,
                  saving: false,
                  data: res,
                  error: res.error || '',
                  repoInput: res.repo || prev.repoInput,
                })
              : prev,
          );
        } catch (error) {
          setUpdatePanel((prev) =>
            prev ? Object.assign({}, prev, { loading: false, saving: false, error: error.message }) : prev,
          );
        }
      };

      const openUpdatePanel = () => {
        setUpdatePanel({ open: true, loading: true, applying: false, data: null, result: null, restart: null, error: '', repoInput: '', editingRepo: false, saving: false });
        void fetchUpdate({ force: true });
      };

      const saveUpdateRepo = () => {
        if (!updatePanel) return;
        const repo = String(updatePanel.repoInput || '').trim();
        if (!repo) {
          setUpdatePanel((prev) => (prev ? Object.assign({}, prev, { error: '请填写 GitHub 仓库，例如 owner/repo' }) : prev));
          return;
        }
        void fetchUpdate({ repo, force: true });
      };

      const applyUpdateNow = async () => {
        if (!updatePanel || !updatePanel.data || !updatePanel.data.hasUpdate) return;
        if (pomoTimer && pomoTimer.running) {
          setUpdatePanel((prev) => (prev ? Object.assign({}, prev, { error: '番茄钟正在计时，暂停或结束后再更新' }) : prev));
          return;
        }
        setUpdatePanel((prev) => (prev ? Object.assign({}, prev, { applying: true, error: '', result: null, restart: null }) : prev));
        try {
          const res = await api('/calendar/api/update-apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ restart: true }),
          });
          setUpdatePanel((prev) => (prev
            ? Object.assign({}, prev, {
                applying: false,
                result: res.update || null,
                restart: res.restart || null,
              })
            : prev));
        } catch (error) {
          setUpdatePanel((prev) => (prev
            ? Object.assign({}, prev, { applying: false, error: error.message })
            : prev));
        }
      };

      const [calDragSource, setCalDragSource] = useState(null);
      const [calDragTarget, setCalDragTarget] = useState(null);
      const [taskDragSource, setTaskDragSource] = useState(null);
      const [taskDragTarget, setTaskDragTarget] = useState(null);
      const [matrixDragTask, setMatrixDragTask] = useState(null);
      const [matrixDropQuadrant, setMatrixDropQuadrant] = useState(null);
      const [matrixMoving, setMatrixMoving] = useState('');
      const dragTaskRef = useRef(null);
      const dayClickBlockedRef = useRef(0);
      const modalDialogRef = useRef(null);

      const loadMyTasks = useCallback(async () => {
        setMyTasks((prev) => Object.assign({}, prev, { loading: true, error: '' }));
        try {
          const res = await api('/calendar/api/tasks?t=' + Date.now());
          setMyTasks({ loading: false, error: '', tasks: res.tasks || [] });
        } catch (error) {
          setMyTasks((prev) => Object.assign({}, prev, { loading: false, error: error.message }));
        }
      }, []);

      useEffect(() => {
        loadMyTasks();
      }, [loadMyTasks]);

      const loadCategories = useCallback(async () => {
        setCategoriesLoading(true);
        try {
          const res = await api('/calendar/api/categories?t=' + Date.now());
          setCategories(res.categories || []);
          setCategoriesError('');
        } catch (error) {
          setCategoriesError(error.message);
        } finally {
          setCategoriesLoading(false);
        }
      }, []);

      useEffect(() => {
        loadCategories();
      }, [loadCategories]);

      useEffect(() => {
        if (!taskCategoryId || taskCategoryId === 'none') return;
        if (!categories.some((category) => String(category.id) === String(taskCategoryId))) {
          setTaskCategoryId(null);
        }
      }, [categories, taskCategoryId]);

      const patchCategoryLocal = (id, patch) => {
        setCategories((prev) =>
          prev.map((category) => (String(category.id) === String(id) ? Object.assign({}, category, patch) : category)),
        );
      };

      const saveCategory = async (category) => {
        const name = String(category.name || '').trim();
        if (!name) {
          setCategoriesError('分类名称不能为空');
          loadCategories();
          return;
        }
        setCategoryBusy(String(category.id));
        try {
          const res = await api('/calendar/api/category-update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: category.id, name, color: category.color }),
          });
          setCategories((prev) =>
            prev.map((item) => (String(item.id) === String(category.id) ? res.category : item)),
          );
          setCategoriesError('');
        } catch (error) {
          setCategoriesError(error.message);
          loadCategories();
        } finally {
          setCategoryBusy('');
        }
      };

      const createCategory = async () => {
        const name = String(categoryDraft.name || '').trim();
        if (!name) {
          setCategoriesError('请填写分类名称');
          return;
        }
        setCategoryBusy('create');
        try {
          const res = await api('/calendar/api/category-create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, color: categoryDraft.color }),
          });
          setCategoryDraft({ name: '', color: '#2f7cf6' });
          await loadCategories();
          setCategoriesError('');
        } catch (error) {
          setCategoriesError(error.message);
        } finally {
          setCategoryBusy('');
        }
      };

      const deleteCategory = async (category) => {
        const count = Number(category.taskCount) || 0;
        const message = count
          ? '删除分类「' + category.name + '」？该分类下的 ' + count + ' 个任务会变成未分类。'
          : '删除分类「' + category.name + '」？';
        if (!window.confirm(message)) return;
        setCategoryBusy('delete-' + category.id);
        try {
          await api('/calendar/api/category-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: category.id }),
          });
          setCategories((prev) => prev.filter((item) => String(item.id) !== String(category.id)));
          setCategoriesError('');
          loadMyTasks();
          loadCategories();
        } catch (error) {
          setCategoriesError(error.message);
        } finally {
          setCategoryBusy('');
        }
      };

      useEffect(() => {
        if (activeView !== 'calendar' || !dayTaskId) return;
        const task = (myTasks.tasks || []).find((item) => String(item.id) === String(dayTaskId));
        if (task && isDroppedStatus(task.status)) {
          setDayTaskId(null);
          setDayDetail({ loading: false, task: null, descDraft: '', busy: '', error: '', message: '' });
        }
      }, [activeView, dayTaskId, myTasks.tasks]);

      useEffect(
        () => () => {
          if (descTimerRef.current) window.clearTimeout(descTimerRef.current);
          const pending = descPendingRef.current;
          if (pending && pending.taskId) {
            api('/calendar/api/task-desc', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: pending.taskId, description: pending.description }),
            }).catch(() => {});
          }
        },
        [],
      );

      useEffect(() => {
        const el = rootRef.current;
        const parent = el && el.parentElement;
        if (!el || !parent) return undefined;
        let frame = 0;
        const fit = () => {
          frame = 0;
          if (!el.isConnected || !parent.isConnected) return;
          const rect = el.getBoundingClientRect();
          const parentWidth = parent.clientWidth;
          const viewportWidth = Math.max(0, window.innerWidth - Math.max(0, rect.left));
          const width = Math.max(parentWidth || 0, viewportWidth || 0);
          if (!width) return;
          if (Math.abs(rect.width - width) > 2) el.style.width = width + 'px';
        };
        const schedule = () => {
          if (frame) return;
          frame = window.requestAnimationFrame(fit);
        };
        fit();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
        if (observer) observer.observe(parent);
        window.addEventListener('resize', schedule);
        return () => {
          if (frame) window.cancelAnimationFrame(frame);
          if (observer) observer.disconnect();
          window.removeEventListener('resize', schedule);
        };
      }, []);

      const loadPomodoroStats = useCallback(async (day) => {
        setPomoStats((prev) => Object.assign({}, prev, { loading: true, error: '' }));
        try {
          const res = await api('/calendar/api/pomodoro?date=' + encodeURIComponent(day) + '&t=' + Date.now());
          setPomoStats({ loading: false, error: '', data: res.stats });
        } catch (error) {
          setPomoStats({ loading: false, error: error.message, data: null });
        }
      }, []);

      useEffect(() => {
        if (activeView === 'pomodoro') loadPomodoroStats(pomoDay);
      }, [activeView, pomoDay, loadPomodoroStats]);

      useEffect(() => {
        if (!pomoTimer) return undefined;
        const timer = window.setInterval(() => setPomoNow(Date.now()), 500);
        return () => window.clearInterval(timer);
      }, [pomoTimer]);

      useEffect(() => {
        try {
          if (pomoTimer) localStorage.setItem(POMO_ACTIVE_KEY, JSON.stringify(pomoTimer));
          else localStorage.removeItem(POMO_ACTIVE_KEY);
        } catch (error) {
          /* storage unavailable */
        }
      }, [pomoTimer]);

      useEffect(() => {
        if (!pomoTimer || !pomoTimer.running) return undefined;
        const timer = window.setInterval(() => {
          try {
            const now = Date.now();
            const snapshot = Object.assign({}, pomoTimer, {
              elapsedMs: pomoTimer.elapsedMs + Math.max(0, now - pomoTimer.startedAt),
              startedAt: now,
            });
            localStorage.setItem(POMO_ACTIVE_KEY, JSON.stringify(snapshot));
          } catch (error) {
            /* storage unavailable */
          }
        }, 5000);
        return () => window.clearInterval(timer);
      }, [pomoTimer]);

      useEffect(() => {
        const timer = window.setInterval(() => setDayNow(new Date()), 30000);
        return () => window.clearInterval(timer);
      }, []);

      useEffect(() => {
        let frame = 0;
        const onResize = () => {
          if (frame) return;
          frame = window.requestAnimationFrame(() => {
            frame = 0;
            setDayLayoutTick((tick) => tick + 1);
          });
        };
        window.addEventListener('resize', onResize);
        return () => {
          if (frame) window.cancelAnimationFrame(frame);
          window.removeEventListener('resize', onResize);
        };
      }, []);

      useEffect(() => {
        const timers = new Map();
        const onScroll = (event) => {
          const target = event.target;
          if (!(target instanceof Element) || !target.closest('.lc-root')) return;
          target.classList.add('lc-scrolling');
          const previous = timers.get(target);
          if (previous) window.clearTimeout(previous);
          timers.set(
            target,
            window.setTimeout(() => {
              target.classList.remove('lc-scrolling');
              timers.delete(target);
            }, 900),
          );
        };
        document.addEventListener('scroll', onScroll, true);
        return () => {
          document.removeEventListener('scroll', onScroll, true);
          for (const timer of timers.values()) window.clearTimeout(timer);
        };
      }, []);

      useEffect(() => writeBool(DONE_KEY, showDoneTasks), [showDoneTasks]);
      useEffect(() => writeBool(NONWORK_KEY, showNonWorkdays), [showNonWorkdays]);
      useEffect(() => {
        try {
          localStorage.setItem(TASK_COLS_KEY, JSON.stringify(taskCols));
        } catch (error) {
          /* storage unavailable */
        }
      }, [taskCols]);

      useEffect(() => {
        try {
          localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(collapsedGroups));
        } catch (error) {
          /* storage unavailable */
        }
      }, [collapsedGroups]);

      useEffect(() => {
        try {
          localStorage.setItem(DAY_DETAIL_W_KEY, String(dayDetailW));
        } catch (error) {
          /* storage unavailable */
        }
      }, [dayDetailW]);

      // 窗口或内容区变窄时收回到可用范围，保证中间列表的最小宽度。
      useEffect(() => {
        if (activeView !== 'tasks') return undefined;
        const element = tasksWrapRef.current;
        if (!element) return undefined;
        const normalize = () => {
          const total = element.getBoundingClientRect().width;
          if (!total) return;
          setTaskCols((prev) => {
            let side = clamp(prev.side, 168, 320);
            let detail = clamp(prev.detail, 300, 620);
            const maxDetail = Math.max(300, Math.min(620, total - side - 360 - 10));
            detail = Math.min(detail, maxDetail);
            const maxSide = Math.max(168, Math.min(320, total - detail - 360 - 10));
            side = Math.min(side, maxSide);
            if (side === prev.side && detail === prev.detail) return prev;
            return { side, detail };
          });
        };
        normalize();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(normalize);
        observer.observe(element);
        return () => observer.disconnect();
      }, [activeView]);

      useEffect(() => {
        try {
          localStorage.setItem(ORDER_KEY, JSON.stringify(calendarTaskOrder));
        } catch (error) {
          /* storage unavailable */
        }
      }, [calendarTaskOrder]);

      useEffect(() => {
        try {
          localStorage.setItem(TIMES_KEY, JSON.stringify(calendarDayTimes));
        } catch (error) {
          /* storage unavailable */
        }
      }, [calendarDayTimes]);

      // 数据库里的 start_time 是权威值：本地时间表没有该任务时补进来。
      useEffect(() => {
        setCalendarDayTimes((prev) => {
          let next = prev;
          for (const task of myTasks.tasks) {
            if (task.startTime === null || task.startTime === undefined) continue;
            const key = String(task.id);
            if (prev[key] === task.startTime) continue;
            if (!Object.prototype.hasOwnProperty.call(prev, key) || prev[key] === undefined) {
              if (next === prev) next = Object.assign({}, prev);
              next[key] = Number(task.startTime);
            }
          }
          return next;
        });
      }, [myTasks.tasks]);

      useEffect(() => {
        if (!actionNotice) return undefined;
        const timer = window.setTimeout(() => setActionNotice(null), 4000);
        return () => window.clearTimeout(timer);
      }, [actionNotice]);

      useEffect(() => {
        const dialog = modalDialogRef.current;
        if (!dialog) return;
        if (taskModal && !dialog.open) {
          try {
            dialog.showModal();
          } catch (error) {
            /* already open */
          }
        }
        if (!taskModal && dialog.open) dialog.close();
      }, [taskModal]);

      const orderedTasksFor = (tasks, dateKey, options) => {
        const order = Array.isArray(calendarTaskOrder[dateKey]) ? calendarTaskOrder[dateKey] : [];
        const doneLast = options && options.doneLast;
        if (!order.length) {
          if (!doneLast) return tasks.slice();
          return tasks.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
        }
        const taskById = new Map(tasks.map((task) => [String(task.id), task]));
        const known = order.map((id) => taskById.get(String(id))).filter(Boolean);
        const knownIds = new Set(known.map((task) => String(task.id)));
        const remaining = tasks.filter((task) => !knownIds.has(String(task.id)));
        const result = known.slice();
        for (const task of remaining) {
          const sourceIndex = tasks.findIndex((item) => String(item.id) === String(task.id));
          let insertAt = result.length;
          for (let i = sourceIndex - 1; i >= 0; i -= 1) {
            const pos = result.findIndex((item) => String(item.id) === String(tasks[i].id));
            if (pos >= 0) {
              insertAt = pos + 1;
              break;
            }
          }
          if (insertAt === result.length) {
            for (let i = sourceIndex + 1; i < tasks.length; i += 1) {
              const pos = result.findIndex((item) => String(item.id) === String(tasks[i].id));
              if (pos >= 0) {
                insertAt = pos;
                break;
              }
            }
          }
          result.splice(insertAt, 0, task);
        }
        if (doneLast) return result.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
        return result;
      };

      const reorderTaskList = (dateKey, sourceId, targetId, before, tasks) => {
        const ids = orderedTasksFor(tasks, dateKey).map((task) => String(task.id));
        const source = String(sourceId);
        const target = String(targetId);
        if (source === target || ids.indexOf(source) < 0 || ids.indexOf(target) < 0) return;
        const withoutSource = ids.filter((id) => id !== source);
        const targetIndex = withoutSource.indexOf(target);
        if (targetIndex < 0) return;
        withoutSource.splice(before ? targetIndex : targetIndex + 1, 0, source);
        setCalendarTaskOrder((prev) => Object.assign({}, prev, { [dateKey]: withoutSource }));
      };

      const resetSubtasks = () => {
        subtaskSeqRef.current += 1;
        setSubtasks({ taskId: null, loading: false, error: '', items: [] });
        setSubtaskDraft('');
        setSubtaskBusy(false);
      };

      const loadSubtasks = async (taskId) => {
        const seq = ++subtaskSeqRef.current;
        setSubtasks((prev) =>
          String(prev.taskId) === String(taskId)
            ? Object.assign({}, prev, { loading: true, error: '' })
            : { taskId, loading: true, error: '', items: [] },
        );
        try {
          const res = await api('/calendar/api/subtasks?taskId=' + encodeURIComponent(taskId));
          if (seq !== subtaskSeqRef.current) return;
          setSubtasks({ taskId, loading: false, error: '', items: res.subtasks || [] });
        } catch (error) {
          if (seq !== subtaskSeqRef.current) return;
          setSubtasks({ taskId, loading: false, error: error.message, items: [] });
        }
      };

      const loadDayTaskDetail = async (taskId, seedTask) => {
        const pending = descPendingRef.current;
        if (pending && pending.taskId) {
          descPendingRef.current = null;
          if (descTimerRef.current) {
            window.clearTimeout(descTimerRef.current);
            descTimerRef.current = null;
          }
          descSeqRef.current += 1;
          api('/calendar/api/task-desc', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: pending.taskId, description: pending.description }),
          }).catch(() => {});
        }
        setDescEditing(false);
        setDescStatus('');
        if (!taskId) {
          setDayTaskId(null);
          setDayDetail(null);
          setMatrixDetailOpen(false);
          resetSubtasks();
          return;
        }
        setDayTaskId(taskId);
        loadSubtasks(taskId);
        if (seedTask) {
          setDayDetail({ loading: false, task: seedTask, descDraft: seedTask.description || '', busy: '', error: '', message: '' });
        } else {
          setDayDetail({ loading: true, task: null, descDraft: '', busy: '', error: '', message: '' });
        }
        try {
          const res = await api('/calendar/api/task?id=' + encodeURIComponent(taskId));
          setDayDetail({
            loading: false,
            task: res.task,
            descDraft: res.task.description || '',
            busy: '',
            error: '',
            message: '',
          });
        } catch (error) {
          setDayDetail({ loading: false, task: seedTask || null, descDraft: (seedTask && seedTask.description) || '', busy: '', error: error.message, message: '' });
        }
      };

      const refreshDayTaskDetail = async (taskId) => {
        if (!taskId || String(taskId) !== String(dayTaskId)) return;
        try {
          const res = await api('/calendar/api/task?id=' + encodeURIComponent(taskId));
          setDayDetail((prev) =>
            prev
              ? Object.assign({}, prev, {
                  loading: false,
                  task: res.task,
                  descDraft: prev.descDraft === undefined || prev.descDraft === null ? res.task.description || '' : prev.descDraft,
                })
              : prev,
          );
        } catch (error) {
          /* 保持现有详情，下一次刷新再试 */
        }
      };

      const focusTask = (task) => {
        if (!task) return;
        const anchor = task.deadline || selectedDate || todayKey();
        const date = new Date(anchor + 'T00:00:00');
        setCalendarMode('day');
        setCalendarMonth({ year: date.getFullYear(), month: date.getMonth() + 1 });
        setSelectedDate(anchor);
        loadDayTaskDetail(task.id, task);
      };

      const openPomodoroSetup = (task) => {
        if (!task) return;
        setCalendarStatusMenu(null);
        const block = pomodoroBlock(task);
        if (block) {
          showNotice(block.title);
          return;
        }
        if (pomoTimer) {
          showNotice('已有番茄钟在运行，先停止当前计时再开始新的。');
          return;
        }
        setPomoSetup({
          task,
          mode: 'countdown',
          minutes: 25,
          customOpen: false,
          custom: '',
          error: '',
        });
      };

      const startPomodoro = () => {
        if (!pomoSetup || !pomoSetup.task) return;
        const latestTask = (myTasks.tasks || []).find(
          (item) => String(item.id) === String(pomoSetup.task.id),
        );
        const block = pomodoroBlock(latestTask || pomoSetup.task);
        if (block) {
          setPomoSetup(null);
          showNotice(block.title);
          return;
        }
        if (pomoTimer) {
          setPomoSetup(null);
          showNotice('已有番茄钟在运行。');
          return;
        }
        let minutes = pomoSetup.minutes;
        if (pomoSetup.mode === 'countdown' && pomoSetup.customOpen) {
          minutes = Math.round(Number(pomoSetup.custom));
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
            setPomoSetup((prev) => (prev ? Object.assign({}, prev, { error: '自定义时长请输入 1–180 分钟' }) : prev));
            return;
          }
        }
        const now = Date.now();
        setPomoNow(now);
        setPomoTimer({
          taskId: Number(pomoSetup.task.id),
          taskTitle: pomoSetup.task.title || '',
          mode: pomoSetup.mode,
          plannedSeconds: pomoSetup.mode === 'countdown' ? Math.round(minutes * 60) : 0,
          elapsedMs: 0,
          startedAt: now,
          running: true,
          startIso: new Date(now).toISOString(),
          day: todayKey(),
        });
        setPomoSetup(null);
      };

      const pausePomodoro = () => {
        setPomoTimer((prev) =>
          prev && prev.running
            ? Object.assign({}, prev, {
                elapsedMs: prev.elapsedMs + Math.max(0, Date.now() - prev.startedAt),
                running: false,
                startedAt: 0,
              })
            : prev,
        );
      };

      const resumePomodoro = () => {
        setPomoNow(Date.now());
        setPomoTimer((prev) => (prev && !prev.running ? Object.assign({}, prev, { running: true, startedAt: Date.now() }) : prev));
      };

      const finishPomodoro = async (auto) => {
        const timer = pomoTimer;
        if (!timer) return;
        const elapsedSeconds = Math.floor(
          (timer.elapsedMs + (timer.running ? Math.max(0, Date.now() - timer.startedAt) : 0)) / 1000,
        );
        const durationSeconds = auto ? Math.max(1, timer.plannedSeconds) : Math.min(12 * 60 * 60, elapsedSeconds);
        setPomoTimer(null);
        pomoFinishRef.current = false;
        if (!auto && durationSeconds < 5) {
          showNotice('本次不足 5 秒，没有记录。', 'success');
          return;
        }
        try {
          await api('/calendar/api/pomodoro', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              taskId: timer.taskId,
              mode: timer.mode,
              plannedMinutes: timer.mode === 'countdown' ? Math.round(timer.plannedSeconds / 60) : 0,
              durationSeconds,
              startedAt: timer.startIso,
              day: timer.day,
              completed: Boolean(auto),
            }),
          });
          await loadMyTasks();
          if (dayTaskId && String(dayTaskId) === String(timer.taskId)) refreshDayTaskDetail(timer.taskId);
          if (activeView === 'pomodoro' && pomoDay === timer.day) loadPomodoroStats(timer.day);
          if (auto) {
            setPomoCelebrate({
              id: Date.now(),
              taskTitle: timer.taskTitle || '当前任务',
              minutes: Math.max(1, Math.round(timer.plannedSeconds / 60)),
            });
          } else {
            showNotice('记录了 ' + formatDuration(durationSeconds) + ' 专注时长', 'success');
          }
        } catch (error) {
          showNotice('记录番茄失败：' + error.message);
        }
      };

      useEffect(() => {
        if (!pomoTimer || pomoTimer.mode !== 'countdown' || !pomoTimer.running) return;
        const elapsedMs = pomoTimer.elapsedMs + Math.max(0, pomoNow - pomoTimer.startedAt);
        if (elapsedMs >= pomoTimer.plannedSeconds * 1000 && !pomoFinishRef.current) {
          pomoFinishRef.current = true;
          finishPomodoro(true);
        }
      }, [pomoTimer, pomoNow]);

      useEffect(() => {
        if (!pomoCelebrate) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setPomoCelebrate(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [pomoCelebrate]);

      const completeTask = async (task) => {
        if (!task || completingTasks.includes(task.id)) return;
        if (isDroppedStatus(task.status)) {
          showNotice('已放弃的任务不能标记完成');
          return;
        }
        const nextStatus = task.done ? 'wait' : 'done';
        setCompletingTasks((prev) => prev.concat([task.id]));
        try {
          await api('/calendar/api/task-status', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: task.id, statusKey: nextStatus }),
          });
          setMyTasks((prev) =>
            Object.assign({}, prev, {
              tasks: (prev.tasks || []).map((item) =>
                String(item.id) === String(task.id)
                  ? Object.assign({}, item, {
                      done: nextStatus === 'done',
                      status: nextStatus,
                      statusText: nextStatus === 'done' ? '已完成' : '未开始',
                    })
                  : item,
              ),
            }),
          );
          refreshDayTaskDetail(task.id);
        } catch (error) {
          showNotice(error.message);
          loadMyTasks();
        } finally {
          setCompletingTasks((prev) => prev.filter((id) => id !== task.id));
        }
      };

      const openCalendarStatusMenu = (event, task) => {
        if (!task) return;
        event.preventDefault();
        event.stopPropagation();
        const width = 220;
        const estimated = 260 + CAL_STATUS_OPTIONS.length * 34;
        const viewportW = window.innerWidth || 1200;
        const viewportH = window.innerHeight || 800;
        setCalendarStatusMenu({
          task,
          x: Math.min(event.clientX, Math.max(8, viewportW - width - 8)),
          y: Math.min(event.clientY, Math.max(8, viewportH - estimated - 8)),
          current: task.status,
          busy: false,
          error: '',
        });
      };

      const applyCalendarStatus = async (option) => {
        const menu = calendarStatusMenu;
        if (!menu || menu.busy) return;
        if (isDroppedStatus(option.value) && menu.task.done) {
          setCalendarStatusMenu(Object.assign({}, menu, { error: '已完成的任务不能放弃' }));
          return;
        }
        if (isDroppedStatus(menu.task.status) && !isDroppedStatus(option.value)) {
          setCalendarStatusMenu(Object.assign({}, menu, { error: '已放弃的任务不能改回待完成' }));
          return;
        }
        setCalendarStatusMenu(Object.assign({}, menu, { busy: true, error: '' }));
        try {
          const res = await postTaskStatus(menu.task.id, option.value);
          setMyTasks((prev) =>
            Object.assign({}, prev, {
              tasks: (prev.tasks || []).map((item) =>
                String(item.id) === String(menu.task.id)
                  ? Object.assign({}, item, {
                      status: res.task ? res.task.status : option.value,
                      statusText: res.task ? res.task.statusText : option.label,
                      done: option.value === 'done',
                    })
                  : item,
              ),
            }),
          );
          setCalendarStatusMenu(null);
          if (isDroppedStatus(option.value) && String(dayTaskId) === String(menu.task.id)) {
            setDayTaskId(null);
            setDayDetail({ loading: false, task: null, descDraft: '', busy: '', error: '', message: '' });
          } else {
            refreshDayTaskDetail(menu.task.id);
          }
        } catch (error) {
          setCalendarStatusMenu((prev) =>
            prev && String(prev.task.id) === String(menu.task.id)
              ? Object.assign({}, prev, { busy: false, error: error.message })
              : prev,
          );
        }
      };

      const moveTaskDeadline = async (task, date) => {
        if (!task || !date || task.deadline === date) return;
        setMyTasks((prev) =>
          Object.assign({}, prev, {
            tasks: (prev.tasks || []).map((item) => (String(item.id) === String(task.id) ? Object.assign({}, item, { deadline: date }) : item)),
          }),
        );
        try {
          await api('/calendar/api/task-deadline', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: task.id, deadline: date }),
          });
          loadMyTasks();
        } catch (error) {
          showNotice('修改日期失败：' + error.message);
          loadMyTasks();
        }
      };

      const persistDescription = async (taskId, description, seq, options = {}) => {
        const close = !!options.close;
        setDescStatus('saving');
        try {
          const res = await api('/calendar/api/task-desc', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: taskId, description }),
          });
          if (seq !== descSeqRef.current) return;
          if (descPendingRef.current && descPendingRef.current.seq === seq) descPendingRef.current = null;
          setDayDetail((prev) => {
            if (!prev || !prev.task || String(prev.task.id) !== String(taskId)) return prev;
            const unchanged = String(prev.descDraft || '') === String(description);
            return Object.assign({}, prev, {
              busy: '',
              error: '',
              message: close ? '已保存' : prev.message || '',
              task: res.task,
              descDraft: unchanged ? res.task.description || '' : prev.descDraft,
            });
          });
          setMyTasks((prev) =>
            Object.assign({}, prev, {
              tasks: (prev.tasks || []).map((item) => (String(item.id) === String(res.task.id) ? res.task : item)),
            }),
          );
          setDescStatus('saved');
          if (close && String(dayTaskId) === String(taskId)) setDescEditing(false);
        } catch (error) {
          if (seq !== descSeqRef.current) return;
          descPendingRef.current = { taskId, description, seq };
          setDescStatus('error');
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { error: error.message || '描述保存失败' }) : prev));
        }
      };

      const queueDescSave = (taskId, description) => {
        if (descTimerRef.current) window.clearTimeout(descTimerRef.current);
        const seq = ++descSeqRef.current;
        descPendingRef.current = { taskId, description, seq };
        setDescStatus('dirty');
        descTimerRef.current = window.setTimeout(() => {
          descTimerRef.current = null;
          const pending = descPendingRef.current;
          if (!pending || pending.seq !== seq) return;
          persistDescription(pending.taskId, pending.description, pending.seq, { close: false });
        }, 300);
      };

      const saveDayDescription = () => {
        if (!dayDetail || !dayDetail.task) return;
        if (descTimerRef.current) {
          window.clearTimeout(descTimerRef.current);
          descTimerRef.current = null;
        }
        const taskId = dayDetail.task.id;
        const description = String(dayDetail.descDraft || '');
        const pending = descPendingRef.current;
        let seq;
        if (pending && String(pending.taskId) === String(taskId) && pending.description === description) {
          seq = pending.seq;
        } else {
          seq = ++descSeqRef.current;
          descPendingRef.current = { taskId, description, seq };
        }
        persistDescription(taskId, description, seq, { close: true });
      };

      const updateDayPriority = async (priority) => {
        if (!dayDetail || !dayDetail.task || dayDetail.busy) return;
        setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: 'priority', error: '', message: '' }) : prev));
        try {
          const res = await api('/calendar/api/task-priority', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: dayDetail.task.id, priority: Number(priority) }),
          });
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: '', message: '优先级已更新', task: res.task }) : prev));
          setMyTasks((prev) =>
            Object.assign({}, prev, {
              tasks: (prev.tasks || []).map((item) => (String(item.id) === String(res.task.id) ? res.task : item)),
            }),
          );
        } catch (error) {
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: '', error: error.message }) : prev));
        }
      };

      const updateDayCategory = async (categoryId) => {
        if (!dayDetail || !dayDetail.task || dayDetail.busy) return;
        setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: 'category', error: '', message: '' }) : prev));
        try {
          const res = await api('/calendar/api/task-category', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: dayDetail.task.id,
              categoryId: categoryId ? Number(categoryId) : null,
            }),
          });
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: '', message: '分类已更新', task: res.task }) : prev));
          loadCategories();
          setMyTasks((prev) =>
            Object.assign({}, prev, {
              tasks: (prev.tasks || []).map((item) => (String(item.id) === String(res.task.id) ? res.task : item)),
            }),
          );
        } catch (error) {
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: '', error: error.message }) : prev));
        }
      };

      const updateObsidian = (patch) => setObsidian((prev) => Object.assign({}, prev, patch));

      const saveObsidian = async (sync) => {
        if (obsidianBusy) return;
        setObsidianBusy('save');
        setObsidianError('');
        try {
          const data = await api('/calendar/api/obsidian', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              enabled: Boolean(obsidian.enabled),
              vault: obsidian.vault,
              heading: obsidian.heading,
              intervalMinutes: obsidian.intervalMinutes,
              sync: Boolean(sync),
            }),
          });
          if (data.obsidian) setObsidian(data.obsidian);
          if (data.writeError) {
            setObsidianError(data.writeError);
            showNotice('已保存设置，但写入失败：' + data.writeError);
          } else {
            showNotice(sync ? '已保存并写入 Obsidian' : 'Obsidian 设置已保存', 'success');
          }
        } catch (error) {
          setObsidianError(error.message);
          showNotice(error.message);
        } finally {
          setObsidianBusy('');
        }
      };

      const syncObsidianNow = async () => {
        if (obsidianBusy) return;
        setObsidianBusy('sync');
        setObsidianError('');
        try {
          const data = await api('/calendar/api/obsidian-sync', { method: 'POST' });
          if (data.obsidian) setObsidian(data.obsidian);
          showNotice('已写入 Obsidian', 'success');
        } catch (error) {
          setObsidianError(error.message);
          showNotice(error.message);
        } finally {
          setObsidianBusy('');
        }
      };

      const addSubtask = async () => {
        const title = subtaskDraft.trim();
        if (!title || subtaskBusy || !dayDetail || !dayDetail.task) return;
        if (subtasks.items.length >= 10) return;
        setSubtaskBusy(true);
        setSubtasks((prev) => Object.assign({}, prev, { error: '' }));
        try {
          const res = await api('/calendar/api/subtask-create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ taskId: dayDetail.task.id, title }),
          });
          setSubtasks({ taskId: dayDetail.task.id, loading: false, error: '', items: res.subtasks || [] });
          setSubtaskDraft('');
        } catch (error) {
          setSubtasks((prev) => Object.assign({}, prev, { error: error.message }));
        } finally {
          setSubtaskBusy(false);
        }
      };

      const toggleSubtask = async (subtask, checked) => {
        if (!subtask || !dayDetail || !dayDetail.task) return;
        const taskId = dayDetail.task.id;
        setSubtasks((prev) =>
          Object.assign({}, prev, {
            error: '',
            items: (prev.items || []).map((item) => (String(item.id) === String(subtask.id) ? Object.assign({}, item, { done: checked }) : item)),
          }),
        );
        try {
          const res = await api('/calendar/api/subtask-toggle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: subtask.id, done: checked }),
          });
          setSubtasks({ taskId, loading: false, error: '', items: res.subtasks || [] });
        } catch (error) {
          setSubtasks((prev) =>
            Object.assign({}, prev, {
              error: error.message,
              items: (prev.items || []).map((item) => (String(item.id) === String(subtask.id) ? Object.assign({}, item, { done: subtask.done }) : item)),
            }),
          );
        }
      };

      const removeSubtask = async (subtask) => {
        if (!subtask || !dayDetail || !dayDetail.task) return;
        const taskId = dayDetail.task.id;
        setSubtasks((prev) =>
          Object.assign({}, prev, {
            error: '',
            items: (prev.items || []).filter((item) => String(item.id) !== String(subtask.id)),
          }),
        );
        try {
          const res = await api('/calendar/api/subtask-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: subtask.id }),
          });
          setSubtasks({ taskId, loading: false, error: '', items: res.subtasks || [] });
        } catch (error) {
          setSubtasks((prev) => Object.assign({}, prev, { error: error.message }));
          loadSubtasks(taskId);
        }
      };

      const updateDayStatus = async (statusKey) => {
        if (!dayDetail || !dayDetail.task || dayDetail.busy) return;
        const option = STATUS_OPTIONS.find((item) => item.value === statusKey);
        if (!option) return;
        if (isDroppedStatus(dayDetail.task.status) && !isDroppedStatus(statusKey)) {
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { error: '已放弃的任务不能改回待完成' }) : prev));
          return;
        }
        if (isDroppedStatus(statusKey) && dayDetail.task.done) {
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { error: '已完成的任务不能放弃' }) : prev));
          return;
        }
        setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: 'status', error: '', message: '' }) : prev));
        try {
          const res = await postTaskStatus(dayDetail.task.id, statusKey);
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: '', message: '状态已更新', task: res.task }) : prev));
          setMyTasks((prev) =>
            Object.assign({}, prev, {
              tasks: (prev.tasks || []).map((item) => (String(item.id) === String(res.task.id) ? res.task : item)),
            }),
          );
        } catch (error) {
          setDayDetail((prev) => (prev ? Object.assign({}, prev, { busy: '', error: error.message }) : prev));
        }
      };

      const deleteTask = async (task) => {
        if (!task) return;
        if (!window.confirm('删除任务「' + task.title + '」？删除后不可恢复。')) return;
        setCalendarStatusMenu((prev) => (prev ? Object.assign({}, prev, { busy: 'delete', error: '' }) : prev));
        try {
          await api('/calendar/api/task-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: task.id }),
          });
          setCalendarStatusMenu(null);
          setCalendarTaskOrder((prev) => {
            const next = Object.assign({}, prev);
            for (const key of Object.keys(next)) {
              if (Array.isArray(next[key])) next[key] = next[key].filter((id) => String(id) !== String(task.id));
            }
            return next;
          });
          if (String(dayTaskId) === String(task.id)) {
            setDayTaskId(null);
            setDayDetail(null);
            setMatrixDetailOpen(false);
          }
          if (pomoTimer && String(pomoTimer.taskId) === String(task.id)) setPomoTimer(null);
          loadMyTasks();
          loadCategories();
          showNotice('已删除任务', 'success');
        } catch (error) {
          setCalendarStatusMenu((prev) => (prev ? Object.assign({}, prev, { busy: '', error: error.message }) : prev));
        }
      };

      const openTaskModal = (date, _preset, options) => {
        const preset = options || {};
        const fallback = date || selectedDate || todayKey();
        const deadline = preset.deadline || fallback;
        setTaskModal({
          tab: 'single',
          title: '',
          description: '',
          priority: preset.priority ? String(preset.priority) : '3',
          deadline,
          date: deadline,
          startTime: preset.startTime !== undefined ? preset.startTime : null,
          dayView: !!preset.dayView,
          quadrant: preset.quadrant || null,
          quadrantLabel: preset.quadrantLabel || '',
          categoryId: preset.categoryId
            ? String(preset.categoryId)
            : taskCategoryId === 'none'
              ? ''
              : (taskCategoryId && categories.find((category) => String(category.id) === String(taskCategoryId))
                    ? String(taskCategoryId)
                    : categories && categories[0]
                      ? String(categories[0].id)
                      : ''),
          batchText: '',
          batchRows: [],
          error: '',
          saving: false,
        });
      };

      const submitTaskModal = async () => {
        if (!taskModal || taskModal.saving) return;
        const deadline = String(taskModal.deadline || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
          setTaskModal((prev) => (prev ? Object.assign({}, prev, { error: '请选择截止日期' }) : prev));
          return;
        }
        setTaskModal((prev) => (prev ? Object.assign({}, prev, { saving: true, error: '' }) : prev));
        try {
          if (taskModal.tab === 'batch') {
            const rows = (taskModal.batchRows || []).filter((row) => String(row.title || '').trim());
            if (!rows.length) throw new Error('请先识别或填写任务标题');
            for (const row of rows) {
              await api('/calendar/api/task-create', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  title: row.title,
                  description: '',
                  priority: row.priority || taskModal.priority,
                  deadline: row.deadline || deadline,
                  quadrant: taskModal.quadrant || null,
                  categoryId: taskModal.categoryId ? Number(taskModal.categoryId) : null,
                }),
              });
            }
            setTaskModal(null);
            expandTaskGroups(rows.map((row) => row.deadline || deadline));
            showNotice('已创建 ' + rows.length + ' 个任务', 'success');
          } else {
            const title = String(taskModal.title || '').trim();
            if (!title) throw new Error('请填写任务标题');
            const res = await api('/calendar/api/task-create', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                title,
                description: taskModal.description,
                priority: taskModal.priority,
                deadline,
                startTime: taskModal.startTime,
                quadrant: taskModal.quadrant || null,
                categoryId: taskModal.categoryId ? Number(taskModal.categoryId) : null,
              }),
            });
            if (taskModal.quadrantLabel) showNotice('已添加到「' + taskModal.quadrantLabel + '」', 'success');
            if (taskModal.startTime !== null && taskModal.startTime !== undefined) {
              setCalendarDayTimes((prev) => Object.assign({}, prev, { [String(res.task.id)]: Number(taskModal.startTime) }));
            }
            setTaskModal(null);
            expandTaskGroups([deadline]);
            if (taskModal.dayView) {
              setCalendarMode('day');
              setSelectedDate(deadline);
              setDayTaskId(res.task.id);
              setDayDetail({ loading: false, task: res.task, descDraft: res.task.description || '', busy: '', error: '', message: '' });
            }
          }
          loadMyTasks();
          loadCategories();
        } catch (error) {
          setTaskModal((prev) => (prev ? Object.assign({}, prev, { saving: false, error: error.message }) : prev));
        }
      };

      const analyzeBatchTasks = () => {
        if (!taskModal) return;
        const lines = String(taskModal.batchText || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 100);
        setTaskModal((prev) =>
          prev
            ? Object.assign({}, prev, {
                batchRows: lines.map((line, index) => ({
                  key: 'b' + index,
                  title: line,
                  deadline: prev.deadline,
                  priority: prev.priority,
                })),
              })
            : prev,
        );
      };

      const renderCalendarStatusPopup = () => {
        if (!calendarStatusMenu) return null;
        const width = 220;
        const viewportW = window.innerWidth || 1200;
        const viewportH = window.innerHeight || 800;
        const doneTask = !!calendarStatusMenu.task.done;
        const estimated = doneTask ? 190 : 260 + CAL_STATUS_OPTIONS.length * 34;
        const left = clamp(calendarStatusMenu.x, 8, Math.max(8, viewportW - width - 8));
        const top = clamp(calendarStatusMenu.y, 8, Math.max(8, viewportH - estimated - 8));
        const pomoBlock = pomodoroBlock(calendarStatusMenu.task);
        return h(
          'div',
          { className: 'lc-popup-layer', onClick: () => setCalendarStatusMenu(null) },
          h(
            'div',
            {
              className: 'lc-popup lc-cal-status-pop',
              style: { left: left + 'px', top: top + 'px', width: width + 'px' },
              role: 'menu',
              'aria-label': doneTask ? '任务操作' : '修改任务状态',
              onClick: (event) => event.stopPropagation(),
            },
            h('div', { className: 'lc-popup-head' }, '任务操作'),
            h('div', { className: 'lc-cal-status-task', title: calendarStatusMenu.task.title }, calendarStatusMenu.task.title),
            h(
              'button',
              {
                type: 'button',
                className: 'lc-popup-item lc-pomo-start-item' + (pomoBlock ? ' lc-popup-item-disabled' : ''),
                disabled: !!calendarStatusMenu.busy || !!pomoBlock,
                title: pomoBlock ? pomoBlock.title : '开始番茄钟',
                onClick: () => openPomodoroSetup(calendarStatusMenu.task),
              },
              h('span', { className: 'lc-pomo-start-icon' }, '🍅'),
              h('span', { className: 'lc-pomo-start-label' }, pomoBlock ? pomoBlock.label : '开始番茄钟'),
            ),
            h('div', { className: 'lc-popup-sep', style: doneTask ? { display: 'none' } : undefined }),
            h('div', { className: 'lc-popup-head', style: doneTask ? { display: 'none' } : undefined }, '修改任务状态'),
            calendarStatusMenu.error ? h('div', { className: 'lc-cal-status-error' }, calendarStatusMenu.error) : null,
            h(
              'div',
              { className: 'lc-popup-list', style: doneTask ? { display: 'none' } : undefined },
              CAL_STATUS_OPTIONS.map((option) => {
                const active =
                  String(option.value) === String(calendarStatusMenu.current) ||
                  (option.value === 'dropped' && isDroppedStatus(calendarStatusMenu.current));
                const blocked = !!calendarStatusMenu.task.done && isDroppedStatus(option.value);
                return h(
                  'button',
                  {
                    key: option.value,
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': active ? 'true' : 'false',
                    className:
                      'lc-popup-item' +
                      (active ? ' lc-popup-item-active' : '') +
                      (blocked ? ' lc-popup-item-disabled' : ''),
                    disabled: !!calendarStatusMenu.busy || active || blocked,
                    title: blocked ? '已完成的任务不能放弃' : '',
                    onClick: () => applyCalendarStatus(option),
                  },
                  option.label,
                );
              }),
            ),
            h('div', { className: 'lc-popup-sep' }),
            h(
              'button',
              {
                type: 'button',
                className: 'lc-popup-item lc-popup-item-danger',
                disabled: !!calendarStatusMenu.busy,
                onClick: () => deleteTask(calendarStatusMenu.task),
              },
              h('span', { className: 'lc-popup-item-icon' }, h(GlyphIcon, { name: 'trash', size: 15 })),
              h('span', null, '删除'),
            ),
          ),
        );
      };

      const renderPomodoroSetup = () => {
        if (!pomoSetup) return null;
        const task = pomoSetup.task || {};
        const isCountdown = pomoSetup.mode !== 'countup';
        const previewMinutes = isCountdown
          ? pomoSetup.customOpen
            ? Number(pomoSetup.custom) || 0
            : pomoSetup.minutes
          : 0;
        return h(
          'div',
          {
            className: 'lc-pomo-mask',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) setPomoSetup(null);
            },
          },
          h(
            'div',
            { className: 'lc-modal lc-pomo-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '番茄钟设置' },
            h(
              'div',
              { className: 'lc-modal-head' },
              h('span', { className: 'lc-modal-title' }, '开始番茄钟'),
              h(
                'button',
                { type: 'button', className: 'lc-modal-close', title: '关闭', 'aria-label': '关闭', onClick: () => setPomoSetup(null) },
                h(GlyphIcon, { name: 'close', size: 15 }),
              ),
            ),
            h(
              'div',
              { className: 'lc-modal-body lc-pomo-setup-body' },
              h(
                'div',
                { className: 'lc-pomo-setup-task' },
                h('span', { className: 'lc-pomo-setup-icon' }, '🍅'),
                h('span', { className: 'lc-pomo-setup-title', title: task.title }, task.title || '未命名任务'),
              ),
              h(
                'div',
                { className: 'lc-pomo-modes' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-pomo-mode' + (isCountdown ? ' is-active' : ''),
                    onClick: () => setPomoSetup((prev) => (prev ? Object.assign({}, prev, { mode: 'countdown', error: '' }) : prev)),
                  },
                  '倒计时',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-pomo-mode' + (!isCountdown ? ' is-active' : ''),
                    onClick: () => setPomoSetup((prev) => (prev ? Object.assign({}, prev, { mode: 'countup', customOpen: false, error: '' }) : prev)),
                  },
                  '正计时',
                ),
              ),
              isCountdown
                ? h(
                    'div',
                    { className: 'lc-pomo-presets' },
                    POMO_PRESETS.map((minutes) =>
                      h(
                        'button',
                        {
                          key: minutes,
                          type: 'button',
                          className:
                            'lc-pomo-preset' +
                            (!pomoSetup.customOpen && pomoSetup.minutes === minutes ? ' is-active' : ''),
                          onClick: () =>
                            setPomoSetup((prev) =>
                              prev ? Object.assign({}, prev, { minutes, customOpen: false, error: '' }) : prev,
                            ),
                        },
                        minutes + ' 分钟',
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'lc-pomo-preset' + (pomoSetup.customOpen ? ' lc-pomo-preset-active' : ''),
                        onClick: () => setPomoSetup((prev) => (prev ? Object.assign({}, prev, { customOpen: true, error: '' }) : prev)),
                      },
                      '自定义',
                    ),
                  )
                : null,
              isCountdown && pomoSetup.customOpen
                ? h(
                    'label',
                    { className: 'lc-pomo-custom' },
                    h('input', {
                      type: 'number',
                      min: 1,
                      max: 180,
                      className: 'lc-input',
                      value: pomoSetup.custom,
                      placeholder: '输入分钟数（1–180）',
                      autoFocus: true,
                      onChange: (event) =>
                        setPomoSetup((prev) => (prev ? Object.assign({}, prev, { custom: event.target.value, error: '' }) : prev)),
                    }),
                    h('span', null, '分钟'),
                  )
                : null,
              h(
                'div',
                { className: 'lc-pomo-preview' },
                h('span', { className: 'lc-pomo-preview-time' }, isCountdown ? formatPomoClock(previewMinutes * 60) : '00:00'),
                h(
                  'span',
                  { className: 'lc-pomo-preview-hint' },
                  isCountdown ? '倒计时结束后自动记 1 个番茄' : '自由计时，停止时记录本次专注时长',
                ),
              ),
              h(
                'p',
                { className: 'lc-pomo-setup-note' },
                isCountdown ? '完成一个倒计时 = 该任务 +1 🍅，并累计专注时长。' : '正计时不会增加番茄数量，只累计任务专注时长。',
              ),
              pomoSetup.error ? h('div', { className: 'lc-modal-error' }, pomoSetup.error) : null,
            ),
            h(
              'div',
              { className: 'lc-modal-foot' },
              h('button', { type: 'button', className: 'lc-btn lc-btn-ghost', onClick: () => setPomoSetup(null) }, '取消'),
              h('button', { type: 'button', className: 'lc-btn lc-btn-primary', onClick: startPomodoro }, '开始专注'),
            ),
          ),
        );
      };

      const renderPomodoroCelebration = () => {
        if (!pomoCelebrate) return null;
        const close = () => setPomoCelebrate(null);
        return h(
          'div',
          { className: 'lc-praise-mask', onClick: close },
          h(
            'div',
            {
              className: 'lc-praise',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'lc-praise-title',
              onClick: (event) => event.stopPropagation(),
            },
            h(
              'div',
              { className: 'lc-praise-burst', 'aria-hidden': 'true' },
              Array.from({ length: 10 }, (_, index) =>
                h('i', {
                  key: index,
                  className: 'lc-praise-spark',
                  style: {
                    '--a': index * 36 + 'deg',
                    '--d': 72 + (index % 3) * 16 + 'px',
                    animationDelay: 0.08 + (index % 4) * 0.025 + 's',
                  },
                }),
              ),
            ),
            h(
              'div',
              { className: 'lc-praise-badge' },
              h('span', { className: 'lc-praise-thumb', role: 'img', 'aria-label': '点赞' }, '👍'),
            ),
            h('p', { className: 'lc-praise-kicker' }, '专注完成'),
            h('h2', { id: 'lc-praise-title', className: 'lc-praise-title' }, '完成 1 个番茄！'),
            h(
              'p',
              { className: 'lc-praise-copy' },
              '给自己一个大大的赞，' + pomoCelebrate.minutes + ' 分钟的专注已经记到「' + pomoCelebrate.taskTitle + '」。',
            ),
            h(
              'div',
              { className: 'lc-praise-stats' },
              h('span', null, '🍅 +1'),
              h('span', null, '专注 ' + pomoCelebrate.minutes + ' 分钟'),
            ),
            h('button', { type: 'button', className: 'lc-btn lc-btn-primary lc-praise-btn', autoFocus: true, onClick: close }, '收下这个赞'),
          ),
        );
      };

      const renderPomodoroFloat = () => {
        if (!pomoTimer) return null;
        const elapsedMs = pomoTimer.elapsedMs + (pomoTimer.running ? Math.max(0, pomoNow - pomoTimer.startedAt) : 0);
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        const isCountdown = pomoTimer.mode === 'countdown';
        const remainSeconds = isCountdown ? Math.max(0, pomoTimer.plannedSeconds - elapsedSeconds) : 0;
        const progress = isCountdown ? clamp((elapsedSeconds / Math.max(1, pomoTimer.plannedSeconds)) * 100, 0, 100) : 0;
        return h(
          'div',
          { className: 'lc-pomo-float' + (pomoTimer.running ? '' : ' lc-pomo-float-paused'), role: 'region', 'aria-label': '番茄钟' },
          h(
            'div',
            { className: 'lc-pomo-float-head' },
            h('span', { className: 'lc-pomo-float-icon' }, '🍅'),
            h('span', { className: 'lc-pomo-float-title', title: pomoTimer.taskTitle }, pomoTimer.taskTitle),
            h('span', { className: 'lc-pomo-mode-tag' }, isCountdown ? '倒计时' : '正计时'),
          ),
          h('div', { className: 'lc-pomo-clock' }, isCountdown ? formatPomoClock(remainSeconds) : formatPomoClock(elapsedSeconds)),
          isCountdown
            ? h('div', { className: 'lc-pomo-progress' }, h('i', { style: { width: progress + '%' } }))
            : null,
          h(
            'div',
            { className: 'lc-pomo-float-meta' },
            h('span', null, isCountdown ? '目标 ' + Math.round(pomoTimer.plannedSeconds / 60) + ' 分钟' : '自由计时'),
            h('span', null, '已专注 ' + formatDuration(elapsedSeconds)),
          ),
          h(
            'div',
            { className: 'lc-pomo-float-actions' },
            pomoTimer.running
              ? h('button', { type: 'button', className: 'lc-btn lc-btn-ghost', onClick: pausePomodoro }, '暂停')
              : h('button', { type: 'button', className: 'lc-btn lc-btn-ghost', onClick: resumePomodoro }, '继续'),
            h('button', { type: 'button', className: 'lc-btn lc-btn-primary', onClick: () => finishPomodoro(false) }, '停止'),
          ),
        );
      };

      const renderDayDetail = (block) => {
        if (!dayTaskId) {
          return h(
            'aside',
            { className: 'lc-day-detail lc-day-detail-empty' },
            h('div', { className: 'lc-day-detail-empty-title' }, '任务详情'),
            h('p', null, '点击任务查看和编辑任务信息。'),
          );
        }
        if (!dayDetail || dayDetail.loading) {
          return h(
            'aside',
            { className: 'lc-day-detail' },
            h('div', { className: 'lc-day-detail-loading' }, '加载任务详情…'),
          );
        }
        if (dayDetail.error && !dayDetail.task) {
          return h(
            'aside',
            { className: 'lc-day-detail' },
            h('div', { className: 'lc-day-detail-error' }, dayDetail.error),
          );
        }
        const task = dayDetail.task || {};
        const statusText = statusLabelOf(task);
        const statusValue = STATUS_OPTIONS.some((option) => option.value === task.status)
          ? task.status
          : isDroppedStatus(task.status)
            ? 'dropped'
            : 'wait';
        const priorityValue = [1, 2, 3].includes(Number(task.priority)) ? Number(task.priority) : 3;
        const subtaskItems = subtasks.taskId !== null && String(subtasks.taskId) === String(task.id) ? subtasks.items || [] : [];
        const subtaskTotal = subtaskItems.length;
        const subtaskDone = subtaskItems.filter((item) => item.done).length;
        const subtaskPct = subtaskTotal ? Math.round((subtaskDone / subtaskTotal) * 100) : 0;
        const renderSubtasks = () =>
          h(
            'section',
            { className: 'lc-subtasks' },
            h(
              'div',
              { className: 'lc-subtasks-head' },
              h('span', { className: 'lc-subtasks-title' }, '子任务'),
              subtaskTotal
                ? h('span', { className: 'lc-subtasks-count' }, subtaskDone + '/' + subtaskTotal)
                : null,
            ),
            subtaskTotal
              ? h(
                  'div',
                  { className: 'lc-subtask-list' },
                  subtaskItems.map((subtask) =>
                    h(
                      'label',
                      { className: 'lc-subtask-row', key: subtask.id },
                      h('input', {
                        type: 'checkbox',
                        className: 'lc-subtask-check',
                        checked: Boolean(subtask.done),
                        onChange: (event) => toggleSubtask(subtask, event.target.checked),
                      }),
                      h(
                        'span',
                        { className: 'lc-subtask-title' + (subtask.done ? ' is-done' : ''), title: subtask.title },
                        subtask.title,
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'lc-subtask-del',
                          title: '删除子任务',
                          'aria-label': '删除子任务',
                          onClick: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            removeSubtask(subtask);
                          },
                        },
                        h(GlyphIcon, { name: 'trash', size: 12 }),
                      ),
                    ),
                  ),
                )
              : h(
                  'div',
                  { className: 'lc-subtask-empty' },
                  subtasks.loading ? '加载子任务…' : '把任务拆成可以勾选的小步骤',
                ),
            h(
              'div',
              { className: 'lc-subtask-add' },
              h('input', {
                className: 'lc-subtask-input',
                type: 'text',
                value: subtaskDraft,
                maxLength: 80,
                placeholder: subtaskTotal >= 10 ? '已达到 10 个子任务上限' : '添加子任务，按回车确认',
                disabled: subtaskTotal >= 10 || subtaskBusy,
                onChange: (event) => {
                  setSubtaskDraft(event.target.value);
                  setSubtasks((prev) => Object.assign({}, prev, { error: '' }));
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSubtask();
                  }
                },
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'lc-subtask-add-btn',
                  title: '添加子任务',
                  'aria-label': '添加子任务',
                  disabled: subtaskTotal >= 10 || subtaskBusy || !subtaskDraft.trim(),
                  onClick: addSubtask,
                },
                h(GlyphIcon, { name: 'plus', size: 14 }),
              ),
            ),
            subtasks.error
              ? h('div', { className: 'lc-subtask-error' }, subtasks.error)
              : null,
            subtaskTotal
              ? h(
                  'div',
                  { className: 'lc-subtask-progress' },
                  h(
                    'div',
                    {
                      className: 'lc-subtask-progress-bar',
                      role: 'progressbar',
                      'aria-valuemin': 0,
                      'aria-valuemax': 100,
                      'aria-valuenow': subtaskPct,
                    },
                    h('span', { className: 'lc-subtask-progress-fill', style: { width: subtaskPct + '%' } }),
                  ),
                  h('span', { className: 'lc-subtask-progress-text' }, subtaskPct + '%'),
                )
              : null,
          );
        return h(
          'aside',
          { className: 'lc-day-detail' },
          h(
            'div',
            { className: 'lc-day-detail-head' },
            h('div', { className: 'lc-day-detail-title', title: task.title }, task.title || '任务 #' + task.id),
            h(
              'button',
              {
                type: 'button',
                className: 'lc-icon-btn lc-day-detail-close',
                title: '关闭详情',
                'aria-label': '关闭详情',
                onClick: () => {
                  setDayTaskId(null);
                  setDayDetail(null);
                  setMatrixDetailOpen(false);
                  resetSubtasks();
                },
              },
              h(GlyphIcon, { name: 'close', size: 15 }),
            ),
          ),
          h(
            'div',
            { className: 'lc-day-detail-meta' },
            h(
              'label',
              {
                className:
                  'lc-tag lc-tag-' +
                  statusTone(task.status) +
                  ' lc-detail-pill' +
                  (dayDetail.busy === 'status' ? ' lc-detail-pill-busy' : ''),
                title: '点击修改任务状态',
              },
              h('span', null, statusText),
              h(GlyphIcon, { name: 'chevron-down', size: 11 }),
              h(
                'select',
                {
                  className: 'lc-detail-pill-select',
                  value: statusValue,
                  disabled: Boolean(dayDetail.busy),
                  'aria-label': '修改任务状态',
                  onChange: (event) => updateDayStatus(event.target.value),
                },
                STATUS_OPTIONS.map((option) =>
                  h(
                    'option',
                    {
                      key: option.value,
                      value: option.value,
                      disabled:
                        (isDroppedStatus(option.value) && Boolean(dayDetail.task.done)) ||
                        (isDroppedStatus(dayDetail.task.status) && !isDroppedStatus(option.value)),
                    },
                    option.label + (isDroppedStatus(option.value) && dayDetail.task.done ? '（已完成不可）' : ''),
                  ),
                ),
              ),
            ),
            h(
              'label',
              {
                className:
                  'lc-tag lc-detail-pill lc-detail-priority lc-detail-priority-' +
                  priorityValue +
                  (dayDetail.busy === 'priority' ? ' lc-detail-pill-busy' : ''),
                title: '点击修改优先级',
              },
              h('span', null, 'P' + priorityValue),
              h(GlyphIcon, { name: 'chevron-down', size: 11 }),
              h(
                'select',
                {
                  className: 'lc-detail-pill-select',
                  value: String(priorityValue),
                  disabled: Boolean(dayDetail.busy),
                  'aria-label': '修改优先级',
                  onChange: (event) => updateDayPriority(Number(event.target.value)),
                },
                [1, 2, 3].map((value) => h('option', { key: value, value: String(value) }, 'P' + value)),
              ),
            ),
            h(
              'label',
              {
                className:
                  'lc-tag lc-detail-pill lc-detail-category' +
                  (dayDetail.busy === 'category' ? ' lc-detail-pill-busy' : ''),
                style: { '--lc-cat': taskCategoryColor(task) },
                title: '点击修改任务分类',
              },
              h('span', { className: 'lc-cat-dot' }),
              h('span', { className: 'lc-detail-cat-name' }, task.categoryName || '未分类'),
              h(GlyphIcon, { name: 'chevron-down', size: 11 }),
              h(
                'select',
                {
                  className: 'lc-detail-pill-select',
                  value: task.categoryId ? String(task.categoryId) : '',
                  disabled: Boolean(dayDetail.busy),
                  'aria-label': '修改任务分类',
                  onChange: (event) => updateDayCategory(event.target.value),
                },
                h('option', { value: '' }, '未分类'),
                categories.map((category) =>
                  h('option', { key: category.id, value: String(category.id) }, category.name),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lc-day-focus-row' },
            h('span', { className: 'lc-day-focus-label' }, '专注'),
            h('span', { className: 'lc-day-focus-time' }, formatDuration(task.focusSeconds || 0)),
            h(TomatoMarks, { count: task.pomodoroCount, className: 'lc-day-focus-marks' }),
            pomodoroBlock(task)
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-day-pomo-btn',
                    title: '开始番茄钟',
                    onClick: () => openPomodoroSetup(task),
                  },
                  '开始专注',
                ),
          ),
          h(
            'div',
            { className: 'lc-day-field lc-day-desc-field' },
            h(
              'div',
              { className: 'lc-md-head' },
              h('label', { className: 'lc-day-field-label' }, '任务描述'),
              descEditing
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'lc-md-edit-btn',
                      disabled: !!dayDetail.busy,
                      onClick: () => setDescEditing(true),
                    },
                    '编辑',
                  ),
            ),
            descEditing
              ? h(
                  'div',
                  { className: 'lc-md-editor' },
                  h('textarea', {
                    className: 'lc-md-input',
                    value: dayDetail.descDraft || '',
                    placeholder: '添加任务描述…',
                    autoFocus: true,
                    disabled: !!dayDetail.busy,
                    onBlur: (event) => {
                      const next = event.relatedTarget;
                      if (next && event.currentTarget.parentElement && event.currentTarget.parentElement.contains(next)) return;
                      saveDayDescription();
                    },
                    onChange: (event) => {
                      const value = event.target.value;
                      setDayDetail((prev) => (prev ? Object.assign({}, prev, { descDraft: value, message: '' }) : prev));
                      if (dayDetail.task) queueDescSave(dayDetail.task.id, value);
                    },
                    onKeyDown: (event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        saveDayDescription();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        saveDayDescription();
                      }
                    },
                  }),
                )
              : h(
                  'div',
                  {
                    className: 'lc-md-view',
                    role: 'textbox',
                    tabIndex: 0,
                    onClick: (event) => {
                      if (event.target.closest && event.target.closest('a, input')) return;
                      const selection = window.getSelection ? String(window.getSelection() || '') : '';
                      if (!dayDetail.busy && !selection) setDescEditing(true);
                    },
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDescEditing(true);
                      }
                    },
                  },
                  dayDetail.descDraft && dayDetail.descDraft.trim()
                    ? renderMarkdown(dayDetail.descDraft)
                    : h('span', { className: 'lc-md-empty' }, '点击这里添加描述'),
                ),
            dayDetail.error
              ? h(
                  'div',
                  { className: 'lc-day-desc-foot' },
                  h('span', { className: 'lc-day-detail-error' }, dayDetail.error),
                )
              : null,
          ),
          renderSubtasks(),
        );
      };

      const renderCalendar = () => {
        const rawDayStart = Number(dayStartMin);
        const rawDayEnd = Number(dayEndMin);
        const dayStart = Math.max(0, Math.min(24 * 60 - 60, Number.isFinite(rawDayStart) ? rawDayStart : DEFAULT_DAY_START_MIN));
        const dayEnd = Math.max(dayStart + 60, Math.min(24 * 60, Number.isFinite(rawDayEnd) ? rawDayEnd : DEFAULT_DAY_END_MIN));
        const dayViewportH = dayViewRef.current ? dayViewRef.current.clientHeight : Math.max(360, window.innerHeight - 100);
        const pxPerMin = Math.max(DAY_PX_PER_MIN, dayViewportH / Math.max(60, dayEnd - dayStart));
        const isWeek = calendarMode === 'week';
        const isDay = calendarMode === 'day';
        const pad = (value) => String(value).padStart(2, '0');
        const dateKeyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        const today = new Date();
        const todayKey = dateKeyOf(today);
        const byDate = new Map();
        const calendarTasks = (myTasks.tasks || []).filter(
          (task) => !isDroppedStatus(task.status) && (showDoneTasks || !task.done),
        );
        for (const task of calendarTasks || []) {
          if (!task.deadline) continue;
          if (!byDate.has(task.deadline)) byDate.set(task.deadline, []);
          byDate.get(task.deadline).push(task);
        }
        const eventsByDate = new Map();
        if (syncCalendar) {
          for (const event of localEvents.events || []) {
            const start = new Date(event.start);
            if (!Number.isFinite(start.getTime())) continue;
            const key = dateKeyOf(start);
            if (!eventsByDate.has(key)) eventsByDate.set(key, []);
            eventsByDate.get(key).push(event);
          }
        }
        const reorderTasksFor = (dateKey, sourceId, targetId, before) => {
          const tasks = byDate.get(dateKey) || [];
          const ids = orderedTasksFor(tasks, dateKey, { doneLast: isWeek }).map((task) => String(task.id));
          const source = String(sourceId);
          const target = String(targetId);
          if (source === target || ids.indexOf(source) < 0 || ids.indexOf(target) < 0) return;
          const withoutSource = ids.filter((id) => id !== source);
          const targetIndex = withoutSource.indexOf(target);
          if (targetIndex < 0) return;
          withoutSource.splice(before ? targetIndex : targetIndex + 1, 0, source);
          setCalendarTaskOrder((prev) => Object.assign({}, prev, { [dateKey]: withoutSource }));
        };
        const setCalendarDropTarget = (dateKey, taskId, before) => {
          setCalDragTarget((prev) =>
            prev && prev.date === dateKey && prev.taskId === taskId && prev.before === before
              ? prev
              : { date: dateKey, taskId, before },
          );
        };
        const beginCalendarTaskDrag = (event, task, dateKey) => {
          dragTaskRef.current = task;
          setCalDragSource({ date: dateKey, taskId: String(task.id) });
          setCalDragTarget(null);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            try {
              event.dataTransfer.setData('text/plain', String(task.id));
            } catch (error) {
              /* ignore */
            }
          }
        };
        const overCalendarTask = (event, task, dateKey) => {
          if (!dragTaskRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          setCalendarDropTarget(
            dateKey,
            String(task.id),
            event.clientY < rect.top + rect.height / 2,
          );
        };
        const dropCalendarTask = (event, task, dateKey) => {
          event.preventDefault();
          event.stopPropagation();
          const source = dragTaskRef.current;
          const rect = event.currentTarget.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          dragTaskRef.current = null;
          setCalDragTarget(null);
          setCalDragSource(null);
          if (!source) return;
          if (source.deadline === dateKey) {
            reorderTasksFor(dateKey, source.id, task.id, before);
          } else {
            moveTaskDeadline(source, dateKey);
          }
        };
        const endCalendarTaskDrag = () => {
          dragTaskRef.current = null;
          setCalDragTarget(null);
          setCalDragSource(null);
        };
        const weekNames = ['一', '二', '三', '四', '五', '六', '日'];
        const buildCell = (date, colIndex, colTotal) => {
          const key = dateKeyOf(date);
          const weekend = cnIsWeekendDay(date) && !cnIsMakeupWorkday(date);
          const eventNodes = (eventsByDate.get(key) || []).map((event, eventIndex) => {
            const start = new Date(event.start);
            const startMinutes = start.getHours() * 60 + start.getMinutes();
            return h(
              'div',
              {
                key: 'event-' + (event.id || eventIndex) + '-' + eventIndex,
                className: 'lc-cal-event',
                title: (event.calendar ? event.calendar + ' · ' : '') + event.title + '（本机日程，只读）',
                onClick: (clickEvent) => clickEvent.stopPropagation(),
                onDoubleClick: (clickEvent) => clickEvent.stopPropagation(),
              },
              h('span', { className: 'lc-cal-event-time' }, clockText(startMinutes)),
              h('span', { className: 'lc-cal-event-title' }, event.title),
            );
          });
          const shownEvents = isWeek ? eventNodes : eventNodes.slice(0, 2);
          const taskLimit = isWeek ? undefined : Math.max(0, 3 - shownEvents.length);
          return h(
            'div',
            {
              key,
              'data-cal-date': key,
              className:
                'lc-cal-cell' +
                (weekend ? ' lc-cal-weekend' : '') +
                (key === todayKey ? ' lc-cal-today' : '') +
                (key === selectedDate ? ' lc-cal-selected' : '') +
                (colTotal && colIndex === colTotal - 1 ? ' lc-cal-col-last' : ''),
              onClick: () => setSelectedDate(key),
              onDoubleClick: () => openTaskModal(key),
              onDragOver: (event) => {
                event.preventDefault();
                if (calDragTarget) setCalDragTarget(null);
              },
              onDrop: (event) => {
                event.preventDefault();
                const task = dragTaskRef.current;
                dragTaskRef.current = null;
                setCalDragTarget(null);
                setCalDragSource(null);
                if (task && task.deadline !== key) moveTaskDeadline(task, key);
              },
            },
            (() => {
              const calLabel = lunarLabelOf(date);
              return h(
                'div',
                { className: 'lc-cal-day' },
                h(
                  'span',
                  { className: 'lc-cal-day-left' },
                  h('span', { className: 'lc-cal-day-num' }, date.getDate()),
                  CN_DAY_TAGS[key]
                    ? h(
                        'span',
                        {
                          className:
                            'lc-cal-holiday ' + (CN_DAY_TAGS[key] === '休' ? 'lc-cal-holiday-rest' : 'lc-cal-holiday-work'),
                        },
                        CN_DAY_TAGS[key],
                      )
                    : null,
                ),
                calLabel
                  ? h(
                      'span',
                      { className: 'lc-cal-lunar lc-cal-lunar-' + calLabel.type },
                      calLabel.text,
                    )
                  : null,
              );
            })(),
            h(
              'div',
              { className: 'lc-cal-tasks' + (isWeek ? '' : ' lc-cal-tasks-month') },
              shownEvents,
              orderedTasksFor(byDate.get(key) || [], key, { doneLast: true })
                .slice(0, taskLimit)
                .map((task) => {
                  const isDragSource =
                    isWeek &&
                    calDragSource &&
                    calDragSource.date === key &&
                    calDragSource.taskId === String(task.id);
                  const isDropTarget =
                    isWeek &&
                    calDragTarget &&
                    calDragTarget.date === key &&
                    calDragTarget.taskId === String(task.id);
                  const isInactive = isDroppedStatus(task.status);
                  const chipClass =
                    'lc-cal-task' +
                    (isWeek ? ' lc-cal-task-week' : ' lc-cal-task-month') +
                    (task.done ? ' lc-cal-task-done' : '') +
                    (isInactive ? ' lc-cal-task-inactive lc-cal-task-' + task.status : '') +
                    (isDragSource ? ' lc-cal-task-dragging' : '') +
                    (isDropTarget
                      ? calDragTarget.before
                        ? ' lc-cal-task-drop-before'
                        : ' lc-cal-task-drop-after'
                      : '') +
                    (task.categoryId ? ' lc-cal-task-cat' : '');
                  const link = h(
                    'a',
                    {
                      className: 'lc-cal-task-link',
                      href: '#',
                      title: task.title + (isInactive ? '（' + statusLabelOf(task) + '）' : ''),
                      draggable: isWeek,
                      onDragStart: isWeek
                        ? (event) => beginCalendarTaskDrag(event, task, key)
                        : undefined,
                      onDragEnd: isWeek ? endCalendarTaskDrag : undefined,
                      onClick: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        focusTask(task);
                      },
                      onClick: (event) => {
                        event.preventDefault();
                        focusTask(task);
                      },
                      onDoubleClick: (event) => event.stopPropagation(),
                    },
                    h('span', { className: 'lc-cal-task-title' }, task.title),
                    h(TomatoMarks, { count: task.pomodoroCount, max: 2, className: 'lc-cal-task-tomatoes' }),
                  );
                  if (isWeek) {
                    return h(
                      'div',
                      {
                        key: task.id,
                        className: chipClass,
                        style: task.categoryId ? taskCategoryStyle(task) : undefined,
                        'data-cal-date': key,
                        'data-task-id': String(task.id),
                        draggable: true,
                        onDragStart: (event) => beginCalendarTaskDrag(event, task, key),
                        onDragEnd: endCalendarTaskDrag,
                        onDragOver: (event) => overCalendarTask(event, task, key),
                        onDrop: (event) => dropCalendarTask(event, task, key),
                        onDoubleClick: (event) => event.stopPropagation(),
                        onContextMenu: (event) => openCalendarStatusMenu(event, task, key),
                      },
                      isInactive
                        ? h(
                            'span',
                            {
                              className: 'lc-cal-task-mark',
                              title: statusLabelOf(task),
                              'aria-label': statusLabelOf(task),
                            },
                            h(DroppedCross, { size: 11 }),
                          )
                        : h('input', {
                            type: 'checkbox',
                            className: 'lc-cal-task-check',
                            checked: Boolean(task.done),
                            disabled: completingTasks.includes(task.id),
                            title: task.done ? '取消完成，回到未开始' : '标记完成',
                            'aria-label': (task.done ? '取消完成：' : '标记完成：') + task.title,
                            onClick: (event) => event.stopPropagation(),
                            onChange: () => completeTask(task),
                          }),
                      link,
                    );
                  }
                  return h(
                    'a',
                    {
                      key: task.id,
                      className: chipClass,
                      style: task.categoryId ? taskCategoryStyle(task) : undefined,
                      href: '#',
                      title: task.title + (isInactive ? '（' + statusLabelOf(task) + '）' : ''),
                      draggable: !task.done,
                      onContextMenu: (event) => openCalendarStatusMenu(event, task, key),
                      onDragStart: task.done
                        ? undefined
                        : () => {
                            dragTaskRef.current = task;
                          },
                      onDragEnd: () => {
                        dragTaskRef.current = null;
                      },
                      onClick: (event) => {
                        event.preventDefault();
                        focusTask(task);
                      },
                      onDoubleClick: (event) => event.stopPropagation(),
                    },
                    h('span', { className: 'lc-cal-task-title' }, task.title),
                    h(TomatoMarks, { count: task.pomodoroCount, max: 2, className: 'lc-cal-task-tomatoes' }),
                  );
                }),
            ),
          );
        };
        let cells = [];
        let titleText = '';
        let weekDays = [];
        let weekMonday = null;
        let weekSunday = null;
        if (isWeek) {
          const anchor = weekAnchor ? new Date(weekAnchor + 'T00:00:00') : today;
          weekMonday = new Date(anchor);
          weekMonday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
          weekSunday = new Date(weekMonday);
          weekSunday.setDate(weekMonday.getDate() + 6);
          for (let i = 0; i < 7; i += 1) {
            const date = new Date(weekMonday);
            date.setDate(weekMonday.getDate() + i);
            weekDays.push(date);
          }
        }
        const visibleWeekDays = isWeek && !showNonWorkdays ? weekDays.filter((date) => !cnIsNonWorkday(date)) : weekDays;
        const allNonWorking = isWeek && !showNonWorkdays && weekDays.length > 0 && visibleWeekDays.length === 0;
        const displayedWeekDays = allNonWorking ? weekDays : visibleWeekDays;
        const weekColumnCount = isWeek ? displayedWeekDays.length : 7;
        if (!isWeek && !isDay) {
          const year = calendarMonth.year;
          const month = calendarMonth.month;
          const first = new Date(year, month - 1, 1);
          const startOffset = (first.getDay() + 6) % 7;
          const days = new Date(year, month, 0).getDate();
          for (let i = 0; i < startOffset; i += 1) {
            cells.push(h('div', { key: 'blank-' + i, className: 'lc-cal-cell lc-cal-blank' }));
          }
          for (let day = 1; day <= days; day += 1) {
            cells.push(buildCell(new Date(year, month - 1, day)));
          }
          while (cells.length < 42) cells.push(h('div', { key: 'tail-' + cells.length, className: 'lc-cal-cell lc-cal-blank' }));
          titleText = year + ' / ' + String(month).padStart(2, '0');
        } else if (isDay) {
          const dayDate = new Date(selectedDate + 'T00:00:00');
          const dayLabel = lunarLabelOf(dayDate);
          titleText =
            dayDate.getFullYear() +
            ' / ' +
            String(dayDate.getMonth() + 1).padStart(2, '0') +
            ' / ' +
            String(dayDate.getDate()).padStart(2, '0') +
            ' 周' +
            '日一二三四五六'[dayDate.getDay()] +
            (dayLabel && dayLabel.type === 'festival' ? ' · ' + dayLabel.text : '');
        } else {
          for (let i = 0; i < displayedWeekDays.length; i += 1) {
            cells.push(buildCell(displayedWeekDays[i], i, displayedWeekDays.length));
          }
          titleText =
            weekMonday.getFullYear() +
            ' / ' +
            String(weekMonday.getMonth() + 1).padStart(2, '0') +
            ' / ' +
            String(weekMonday.getDate()).padStart(2, '0') +
            ' - ' +
            (weekSunday.getFullYear() !== weekMonday.getFullYear() ? weekSunday.getFullYear() + ' / ' : '') +
            String(weekSunday.getMonth() + 1).padStart(2, '0') +
            ' / ' +
            String(weekSunday.getDate()).padStart(2, '0');
        }
        const shift = (delta) => {
          if (isWeek) {
            const anchor = weekAnchor ? new Date(weekAnchor + 'T00:00:00') : new Date(today);
            anchor.setDate(anchor.getDate() + delta * 7);
            setWeekAnchor(dateKeyOf(anchor));
            setCalendarMonth({ year: anchor.getFullYear(), month: anchor.getMonth() + 1 });
          } else if (isDay) {
            const anchor = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date(today);
            anchor.setDate(anchor.getDate() + delta);
            setSelectedDate(dateKeyOf(anchor));
            setCalendarMonth({ year: anchor.getFullYear(), month: anchor.getMonth() + 1 });
          } else {
            setCalendarMonth((prev) => {
              const next = new Date(prev.year, prev.month - 1 + delta, 1);
              return { year: next.getFullYear(), month: next.getMonth() + 1 };
            });
          }
        };
        const goToday = () => {
          const now = new Date();
          setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() + 1 });
          setSelectedDate(dateKeyOf(now));
          setWeekAnchor(dateKeyOf(now));
        };
        const commitDaySchedule = async (task, start, end) => {
          if (!task || !selectedDate) return;
          const duration = Math.max(DAY_SNAP_MIN, Math.min(dayEnd - dayStart, Math.round((end - start) / DAY_SNAP_MIN) * DAY_SNAP_MIN));
          const startMin = Math.max(dayStart, Math.min(dayEnd - duration, Math.round(start / DAY_SNAP_MIN) * DAY_SNAP_MIN));
          const hours = Math.round((duration / 60) * 100) / 100;
          const timeKey = String(task.id);
          const previousStart = calendarDayTimes[timeKey];
          setCalendarDayTimes((prev) => Object.assign({}, prev, { [timeKey]: startMin }));
          setMyTasks((prev) => Object.assign({}, prev, {
            tasks: (prev.tasks || []).map((item) =>
              String(item.id) === String(task.id) ? Object.assign({}, item, { estimate: hours }) : item,
            ),
          }));
          try {
            const res = await api('/calendar/api/task-schedule', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                id: task.id,
                estimate: hours,
                startTime: startMin,
              }),
            });
            setMyTasks((prev) => Object.assign({}, prev, {
              tasks: (prev.tasks || []).map((item) =>
                String(item.id) === String(task.id)
                  ? Object.assign({}, item, { estimate: hours, startTime: startMin })
                  : item,
              ),
            }));
            if (dayTaskId && String(dayTaskId) === String(task.id)) refreshDayTaskDetail(task.id);
          } catch (error) {
            setCalendarDayTimes((prev) => {
              const next = Object.assign({}, prev);
              if (previousStart === undefined) delete next[timeKey];
              else next[timeKey] = previousStart;
              return next;
            });
            showNotice('同步任务时间失败：' + (error.message || ''));
            loadMyTasks(true);
          }
        };

        const beginDayResize = (event, block, mode) => {
          if (!block || !block.task) return;
          event.preventDefault();
          event.stopPropagation();
          const startY = event.clientY;
          let latest = { start: block.start, end: block.end };
          const onMove = (moveEvent) => {
            const delta = Math.round((moveEvent.clientY - startY) / pxPerMin / DAY_SNAP_MIN) * DAY_SNAP_MIN;
            if (mode === 'start') {
              const nextStart = Math.max(dayStart, Math.min(block.end - DAY_SNAP_MIN, block.start + delta));
              latest = { start: nextStart, end: block.end };
            } else {
              const nextEnd = Math.max(block.start + DAY_SNAP_MIN, Math.min(dayEnd, block.end + delta));
              latest = { start: block.start, end: nextEnd };
            }
            setDayResize({
              id: String(block.task.id),
              mode,
              start: latest.start,
              end: latest.end,
            });
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setDayResize(null);
            if (latest.start !== block.start || latest.end !== block.end) {
              dayClickBlockedRef.current = Date.now() + 250;
              commitDaySchedule(block.task, latest.start, latest.end);
            }
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        };

        const beginDayMove = (event, block) => {
          if (!block || !block.task || event.button !== 0) return;
          if (event.target.closest('.lc-day-event-check, .lc-day-resize')) return;
          event.preventDefault();
          event.stopPropagation();
          const startY = event.clientY;
          const duration = block.end - block.start;
          let latest = { start: block.start, end: block.end };
          let moved = false;
          const onMove = (moveEvent) => {
            if (!moved && Math.abs(moveEvent.clientY - startY) < 3) return;
            moved = true;
            const delta = Math.round((moveEvent.clientY - startY) / pxPerMin / DAY_SNAP_MIN) * DAY_SNAP_MIN;
            const nextStart = Math.max(dayStart, Math.min(dayEnd - duration, block.start + delta));
            latest = { start: nextStart, end: nextStart + duration };
            setDayResize({ id: String(block.task.id), mode: 'move', start: latest.start, end: latest.end });
          };
          const cleanup = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            setDayResize(null);
          };
          const onUp = () => {
            const changed = latest.start !== block.start || latest.end !== block.end;
            cleanup();
            if (moved) dayClickBlockedRef.current = Date.now() + 250;
            if (changed) commitDaySchedule(block.task, latest.start, latest.end);
          };
          const onCancel = () => cleanup();
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onCancel);
        };

        const renderDayTask = (block) => {
          const task = block.task;
          const preview = dayResize && String(dayResize.id) === String(task.id) ? dayResize : block;
          const top = (preview.start - dayStart) * pxPerMin;
          const height = Math.max(22, (preview.end - preview.start) * pxPerMin);
          const isInactive = isDroppedStatus(task.status);
          const laneCount = block.laneCount || 1;
          const lane = block.lane || 0;
          const left = lane * (100 / laneCount) + 1;
          const width = Math.max(18, 100 / laneCount - 2);
          return h(
            'div',
            {
              key: task.id,
              className:
                'lc-day-event' +
                (task.done ? ' lc-day-event-done' : '') +
                (isInactive ? ' lc-day-event-inactive lc-day-event-' + task.status : '') +
                (dayResize && dayResize.mode === 'move' && String(dayResize.id) === String(task.id) ? ' lc-day-event-dragging' : '') +
                (dayTaskId && String(dayTaskId) === String(task.id) ? ' lc-day-event-selected' : '') +
                (height < 42 ? ' lc-day-event-short' : '') +
                (task.categoryId ? ' lc-day-event-cat' : ''),
              style: Object.assign(
                { top: top + 'px', left: left + '%', width: width + '%', height: height + 'px' },
                task.categoryId ? taskCategoryStyle(task) : null,
              ),
              title: task.title,
              'data-task-id': String(task.id),
              onClick: (event) => {
                if (event.target.closest('.lc-day-event-check, .lc-day-resize')) return;
                if (Date.now() < dayClickBlockedRef.current) return;
                loadDayTaskDetail(task.id, task);
              },
              onPointerDown: (event) => beginDayMove(event, block),
              onDoubleClick: (event) => event.stopPropagation(),
              onContextMenu: (event) => openCalendarStatusMenu(event, task, selectedDate),
            },
            h(
              'span',
              { className: 'lc-day-event-head' },
              isInactive
                ? h('span', { className: 'lc-day-event-mark' }, h(DroppedCross, { size: 10 }))
                : h('input', {
                    type: 'checkbox',
                    className: 'lc-day-event-check',
                    checked: Boolean(task.done),
                    disabled: completingTasks.includes(task.id),
                    title: task.done ? '取消完成，回到未开始' : '标记完成',
                    'aria-label': (task.done ? '取消完成：' : '标记完成：') + task.title,
                    onClick: (event) => event.stopPropagation(),
                    onChange: () => completeTask(task),
                  }),
              h(
                'span',
                { className: 'lc-day-event-title' },
                task.title,
              ),
              h(TomatoMarks, { count: task.pomodoroCount, max: 2, className: 'lc-day-event-tomatoes' }),
            ),
            h('span', { className: 'lc-day-event-time' }, clockText(preview.start) + '–' + clockText(preview.end)),
            h(
              'span',
              {
                className: 'lc-day-resize lc-day-resize-top',
                title: '拖动调整开始时间',
                onPointerDown: (event) => beginDayResize(event, block, 'start'),
              },
            ),
            h(
              'span',
              {
                className: 'lc-day-resize lc-day-resize-bottom',
                title: '拖动调整结束时间',
                onPointerDown: (event) => beginDayResize(event, block, 'end'),
              },
            ),
          );
        };


        const renderDayEvent = (block) => {
          const event = block.event;
          const top = (block.start - dayStart) * pxPerMin;
          const height = Math.max(22, (block.end - block.start) * pxPerMin);
          const laneCount = block.laneCount || 1;
          const lane = block.lane || 0;
          const left = lane * (100 / laneCount) + 1;
          const width = Math.max(18, 100 / laneCount - 2);
          return h(
            'div',
            {
              key: 'external-' + (event.id || event.title) + '-' + block.start,
              className: 'lc-day-event lc-day-event-external' + (height < 42 ? ' lc-day-event-short' : ''),
              style: { top: top + 'px', left: left + '%', width: width + '%', height: height + 'px' },
              title: (event.calendar ? event.calendar + ' · ' : '') + event.title + '（本机日程，只读）',
              onClick: (clickEvent) => clickEvent.stopPropagation(),
              onDoubleClick: (clickEvent) => clickEvent.stopPropagation(),
            },
            h(
              'span',
              { className: 'lc-day-event-head' },
              h('span', { className: 'lc-day-event-dot' }),
              h('span', { className: 'lc-day-event-title' }, event.title),
            ),
            h('span', { className: 'lc-day-event-time' }, clockText(block.start) + '–' + clockText(block.end)),
            h('span', { className: 'lc-day-event-source' }, event.calendar || '本机日历'),
          );
        };

        const renderDayView = () => {
          const dayKey = selectedDate;
          const dayDate = new Date(dayKey + 'T00:00:00');
          const dayTasks = orderedTasksFor(byDate.get(dayKey) || [], dayKey);
          let cursor = dayStart;
          const taskBlocks = dayTasks.map((task) => {
            const customStart = Number(calendarDayTimes[String(task.id)]);
            const hasCustomStart = Number.isFinite(customStart) && customStart > 0;
            const storedStart = Number(task.startTime);
            const hasStoredStart =
              task.startTime !== null &&
              task.startTime !== undefined &&
              Number.isFinite(storedStart) &&
              storedStart >= 0;
            const duration = Math.max(DAY_SNAP_MIN, Math.round(((Number(task.estimate) || 1) * 60) / DAY_SNAP_MIN) * DAY_SNAP_MIN);
            const proposedStart = hasCustomStart ? customStart : hasStoredStart ? Math.max(storedStart, dayStart) : Math.max(cursor, dayStart);
            const proposedEnd = proposedStart + duration;
            const start = Math.max(dayStart, proposedStart);
            const end = Math.min(dayEnd, proposedEnd);
            cursor = Math.max(cursor, Math.ceil(end / DAY_SNAP_MIN) * DAY_SNAP_MIN);
            if (end <= start || proposedEnd <= dayStart || proposedStart >= dayEnd) return null;
            return { task, start, end };
          }).filter(Boolean);
          const dayEventBlocks = syncCalendar
            ? (eventsByDate.get(dayKey) || []).map((event) => {
                const startDate = new Date(event.start);
                const endDate = new Date(event.end);
                let proposedStart = startDate.getHours() * 60 + startDate.getMinutes();
                let proposedEnd = endDate.getHours() * 60 + endDate.getMinutes();
                if (!Number.isFinite(proposedStart) || !Number.isFinite(proposedEnd) || proposedEnd <= proposedStart) proposedEnd = proposedStart + 30;
                if (proposedEnd <= dayStart || proposedStart >= dayEnd) return null;
                const start = clamp(proposedStart, dayStart, dayEnd - DAY_SNAP_MIN);
                const end = clamp(proposedEnd, start + DAY_SNAP_MIN, dayEnd);
                return { event, start, end };
              }).filter(Boolean)
            : [];
          const scheduled = taskBlocks.concat(dayEventBlocks);
          const groups = [];
          let currentGroup = [];
          let currentEnd = -1;
          scheduled
            .slice()
            .sort((a, b) => a.start - b.start || a.end - b.end)
            .forEach((block) => {
              if (!currentGroup.length || block.start < currentEnd) {
                currentGroup.push(block);
                currentEnd = Math.max(currentEnd, block.end);
              } else {
                groups.push(currentGroup);
                currentGroup = [block];
                currentEnd = block.end;
              }
            });
          if (currentGroup.length) groups.push(currentGroup);
          for (const group of groups) {
            const laneEnds = [];
            for (const block of group) {
              let lane = laneEnds.findIndex((end) => end <= block.start);
              if (lane < 0) lane = laneEnds.length;
              laneEnds[lane] = block.end;
              block.lane = lane;
            }
            for (const block of group) block.laneCount = laneEnds.length;
          }
          const dayHeight = (dayEnd - dayStart) * pxPerMin;
          const nowMinutes = dayNow.getHours() * 60 + dayNow.getMinutes();
          const showNow = dayKey === todayKey && nowMinutes >= dayStart && nowMinutes <= dayEnd;
          const slots = [];
          for (let minute = dayStart; minute < dayEnd; minute += DAY_SLOT_MIN) {
            slots.push(minute);
          }
          const selectedBlock = scheduled.find((block) => block.task && String(block.task.id) === String(dayTaskId)) || null;
          return h(
            'div',
            {
              className: 'lc-day-view',
              ref: dayViewRef,
              style: { '--lc-day-detail-w': dayDetailW + 'px' },
            },
            h(
              'div',
              { className: 'lc-day-scroll' },
              h(
                'div',
                { className: 'lc-day-canvas', style: { height: dayHeight + 'px' } },
              h(
                'div',
                { className: 'lc-day-axis', style: { height: '100%' } },
              slots.map((minute, index) =>
                h(
                  'div',
                  { key: 'slot-' + minute, className: 'lc-day-slot', style: { height: DAY_SLOT_MIN * pxPerMin + 'px' } },
                  index === 0 || minute % 60 === 0 ? h('span', null, clockText(minute)) : null,
                ),
              ),
            ),
            h(
              'div',
              {
                className: 'lc-day-lane',
                style: { height: '100%' },
                onDoubleClick: (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const minutes = dayStart + Math.round(((event.clientY - rect.top) / pxPerMin) / DAY_SLOT_MIN) * DAY_SLOT_MIN;
                  const startTime = Math.max(dayStart, Math.min(dayEnd - 30, minutes));
                  openTaskModal(dayKey, null, { startTime, dayView: true });
                },
              },
              showNow
                ? h('div', { className: 'lc-day-now-label', style: { top: (nowMinutes - dayStart) * pxPerMin + 'px' } }, clockText(nowMinutes))
                : null,
              showNow
                ? h('div', {
                    className: 'lc-day-now-line',
                    style: { top: (nowMinutes - dayStart) * pxPerMin + 'px' },
                  })
                : null,
              !scheduled.length
                ? h('div', { className: 'lc-day-empty' }, '当天暂无任务或日程，双击空白处新建')
                : null,
              scheduled.map((block) => (block.event ? renderDayEvent(block) : renderDayTask(block))),
            ),
              ),
            ),
            h(
              'div',
              {
                className: 'lc-split',
                role: 'separator',
                'aria-orientation': 'vertical',
                'aria-label': '调整任务详情宽度',
                tabIndex: 0,
                title: '拖动调整任务详情宽度',
                onPointerDown: resizeDayDetail,
                onKeyDown: (event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    nudgeDayDetail(event.key === 'ArrowLeft' ? 10 : -10);
                  }
                },
              },
              h('span', { className: 'lc-split-grip' }),
            ),
            renderDayDetail(selectedBlock),
          );
        };

        return h(
          'section',
          { className: 'lc-cal', 'aria-label': '任务日历' },
          h(
            'div',
            { className: 'lc-cal-head' },
            h(
              'div',
              { className: 'lc-cal-title-wrap' },
              h(
                'div',
                { className: 'lc-cal-title-line' },
                h('div', { className: 'lc-cal-title' }, '任务日历'),
                h(
                  'label',
                  { className: 'lc-cal-done-toggle', title: '在日历上显示/隐藏已完成任务' },
                  h('input', {
                    type: 'checkbox',
                    checked: showDoneTasks,
                    onChange: (event) => setShowDoneTasks(event.target.checked),
                  }),
                  h('span', null, '显示已完成'),
                ),
                isWeek
                  ? h(
                      'label',
                      {
                        className: 'lc-cal-done-toggle lc-cal-nonwork-toggle',
                        title: '显示法定节假日（周末、调休放假日）；调休上班日即使为周末仍显示',
                      },
                      h('input', {
                        type: 'checkbox',
                        checked: showNonWorkdays,
                        onChange: (event) => setShowNonWorkdays(event.target.checked),
                      }),
                      h('span', null, '显示节假日'),
                    )
                  : null,
              ),
              h(
                'div',
                { className: 'lc-cal-sub' },
                isDay
                  ? '双击空白处新建任务；拖动任务调整时间，上下边缘调整时长；右击任务可改状态'
                  : '双击日期空白处新建任务，拖动任务可改截止日期，拖到同日任务上可排序',
                syncCalendar
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'lc-cal-sync' + (localEvents.error ? ' lc-cal-sync-error' : ''),
                        title: localEvents.error || '打开设置',
                        onClick: () => setActiveView('settings'),
                      },
                      h('span', { className: 'lc-cal-sync-dot' }),
                      localEvents.loading
                        ? '本机日历同步中…'
                        : localEvents.error
                          ? '本机日历同步失败'
                          : '本机日程 ' + (localEvents.events.length || 0),
                    )
                  : null,
              ),
            ),
            h(
              'div',
              { className: 'lc-cal-actions' },
                h(
                  'div',
                  { className: 'lc-cal-mode', role: 'tablist', 'aria-label': '日历视图' },
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'tab',
                      className: 'lc-cal-mode-btn' + (isDay ? ' lc-cal-mode-btn-active' : ''),
                      'aria-selected': isDay ? 'true' : 'false',
                      onClick: () => {
                        const anchor = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date();
                        setCalendarMonth({ year: anchor.getFullYear(), month: anchor.getMonth() + 1 });
                        setCalendarMode('day');
                        setDayTaskId(null);
                        setDayDetail(null);
                      },
                    },
                    '日视图',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'tab',
                      className: 'lc-cal-mode-btn' + (isWeek ? ' lc-cal-mode-btn-active' : ''),
                      'aria-selected': isWeek ? 'true' : 'false',
                      onClick: () => {
                        setWeekAnchor(selectedDate || dateKeyOf(today));
                        setCalendarMode('week');
                      },
                    },
                    '周视图',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'tab',
                      className: 'lc-cal-mode-btn' + (calendarMode === 'month' ? ' lc-cal-mode-btn-active' : ''),
                      'aria-selected': calendarMode === 'month' ? 'true' : 'false',
                      onClick: () => setCalendarMode('month'),
                    },
                    '月视图',
                  ),
                ),
              h(
                'button',
                {
                  className: 'lc-icon-btn',
                  type: 'button',
                  title: isWeek ? '上一周' : isDay ? '前一天' : '上个月',
                  'aria-label': isWeek ? '上一周' : isDay ? '前一天' : '上个月',
                  onClick: () => shift(-1),
                },
                h(GlyphIcon, { name: 'chevron-left', size: 16 }),
              ),
              h('span', { className: 'lc-cal-month' }, titleText),
              h(
                'button',
                {
                  className: 'lc-icon-btn',
                  type: 'button',
                  title: isWeek ? '下一周' : isDay ? '后一天' : '下个月',
                  'aria-label': isWeek ? '下一周' : isDay ? '后一天' : '下个月',
                  onClick: () => shift(1),
                },
                h(GlyphIcon, { name: 'chevron-right', size: 16 }),
              ),
              h(
                'button',
                {
                  className: 'lc-icon-btn' + (myTasks.loading ? ' lc-spinning' : ''),
                  type: 'button',
                  title: myTasks.loading ? '刷新中…' : '刷新日历任务',
                  'aria-label': '刷新日历任务',
                  disabled: myTasks.loading,
                  onClick: () => {
                    loadMyTasks(true);
                    if (syncCalendar) void loadLocalEvents(true, true);
                  },
                },
                h(GlyphIcon, { name: 'refresh', size: 16 }),
              ),
              h('button', { className: 'lc-cal-today-btn', type: 'button', onClick: goToday }, '回到今天'),
            ),
          ),
          myTasks.error
            ? h('div', { className: 'lc-cal-error' }, '刷新任务失败：' + myTasks.error)
            : null,
          allNonWorking
            ? h('div', { className: 'lc-cal-filter-note' }, '本周均为法定节假日，暂时显示全部日期')
            : null,
          isDay
            ? renderDayView()
            : h(
            'div',
            {
              className: 'lc-cal-grid' + (isWeek ? ' lc-cal-grid-week' : ''),
              style: { gridTemplateColumns: 'repeat(' + weekColumnCount + ',minmax(0,1fr))' },
            },
            isWeek
              ? displayedWeekDays.map((date, index) =>
                  h(
                    'div',
                    {
                      key: 'week-' + dateKeyOf(date),
                      className:
                        'lc-cal-week' +
                        (cnIsWeekendDay(date) && !cnIsMakeupWorkday(date) ? ' lc-cal-week-weekend' : '') +
                        (index === displayedWeekDays.length - 1 ? ' lc-cal-col-last' : ''),
                    },
                    '周' + '日一二三四五六'[date.getDay()],
                  ),
                )
              : weekNames.map((label, index) =>
                  h(
                    'div',
                    {
                      key: label,
                      className:
                        'lc-cal-week' +
                        (label === '六' || label === '日' ? ' lc-cal-week-weekend' : '') +
                        (index === weekNames.length - 1 ? ' lc-cal-col-last' : ''),
                    },
                    '周' + label,
                  ),
                ),
            cells,
          ),
        );
      };

      const fieldLabel = (text, required) =>
        h(
          'span',
          { className: 'lc-field-label' },
          required ? h('span', { className: 'lc-field-required', 'aria-hidden': true }, '*') : null,
          h('span', { className: 'lc-field-label-text' }, text),
        );

      const renderTaskModal = () => {
        if (!taskModal) return null;
        const single = taskModal.tab !== 'batch';
        const close = () => setTaskModal(null);
        return h(
          'dialog',
          {
            className: 'lc-modal-dialog',
            ref: modalDialogRef,
            'aria-label': '新建任务',
            onCancel: (event) => {
              event.preventDefault();
              close();
            },
          },
          h(
            'div',
            { className: 'lc-modal' + (single ? '' : ' lc-modal-batch'), role: 'dialog', 'aria-modal': 'true', 'aria-label': '新建任务' },
            h(
              'div',
              { className: 'lc-modal-head' },
              h('span', { className: 'lc-modal-title' }, '新建任务'),
              h(
                'button',
                { className: 'lc-modal-close', type: 'button', title: '关闭', 'aria-label': '关闭', onClick: close },
                h(GlyphIcon, { name: 'close', size: 16 }),
              ),
            ),
            h(
              'div',
              { className: 'lc-task-modal-tabs', role: 'tablist', 'aria-label': '新建任务方式' },
              h(
                'button',
                {
                  type: 'button',
                  role: 'tab',
                  className: 'lc-task-modal-tab' + (single ? ' lc-task-modal-tab-active' : ''),
                  'aria-selected': single ? 'true' : 'false',
                  onClick: () => setTaskModal((prev) => (prev ? Object.assign({}, prev, { tab: 'single' }) : prev)),
                },
                '单任务',
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'tab',
                  className: 'lc-task-modal-tab' + (single ? '' : ' lc-task-modal-tab-active'),
                  'aria-selected': single ? 'false' : 'true',
                  onClick: () => setTaskModal((prev) => (prev ? Object.assign({}, prev, { tab: 'batch' }) : prev)),
                },
                '批量任务',
              ),
            ),
            h(
              'div',
              { className: 'lc-modal-body' },
              taskModal.quadrantLabel
                ? h('div', { className: 'lc-modal-target' }, '将添加到「' + taskModal.quadrantLabel + '」')
                : null,
              single
                ? h(
                    React.Fragment,
                    null,
                    h(
                      'label',
                      { className: 'lc-field' },
                      fieldLabel('任务标题', true),
                      h('input', {
                        className: 'lc-input',
                        value: taskModal.title,
                        maxLength: 300,
                        autoFocus: true,
                        placeholder: '例如：整理本周需求优先级',
                        onChange: (event) =>
                          setTaskModal((prev) => (prev ? Object.assign({}, prev, { title: event.target.value }) : prev)),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'lc-field-row' },
                      h(
                        'label',
                        { className: 'lc-field' },
                        fieldLabel('优先级', false),
                        h(
                          'select',
                          {
                            className: 'lc-input',
                            value: taskModal.priority,
                            onChange: (event) =>
                              setTaskModal((prev) => (prev ? Object.assign({}, prev, { priority: event.target.value }) : prev)),
                          },
                          h('option', { value: '1' }, 'P1 高'),
                          h('option', { value: '2' }, 'P2 中'),
                          h('option', { value: '3' }, 'P3 低'),
                        ),
                      ),
                      h(
                        'label',
                        { className: 'lc-field' },
                        fieldLabel('分类', false),
                        h(
                          'select',
                          {
                            className: 'lc-input',
                            value: taskModal.categoryId || '',
                            onChange: (event) =>
                              setTaskModal((prev) => (prev ? Object.assign({}, prev, { categoryId: event.target.value }) : prev)),
                          },
                          h('option', { value: '' }, '未分类'),
                          categories.map((category) =>
                            h('option', { key: category.id, value: String(category.id) }, category.name),
                          ),
                        ),
                        categoriesError
                          ? h('span', { className: 'lc-field-hint' }, '分类读取失败；可在设置页重试')
                          : null,
                      ),
                      h(
                        'label',
                        { className: 'lc-field' },
                        fieldLabel('截止日期', true),
                        h('input', {
                          className: 'lc-input',
                          type: 'date',
                          value: taskModal.deadline,
                          onChange: (event) =>
                            setTaskModal((prev) => (prev ? Object.assign({}, prev, { deadline: event.target.value }) : prev)),
                        }),
                      ),
                    ),
                    taskModal.startTime !== null && taskModal.startTime !== undefined
                      ? h(
                          'label',
                          { className: 'lc-field' },
                          fieldLabel('开始时间', false),
                          h('input', {
                            className: 'lc-input',
                            type: 'time',
                            step: 900,
                            value: clockText(taskModal.startTime),
                            onChange: (event) => {
                              const value = String(event.target.value || '');
                              const parts = value.split(':');
                              if (parts.length !== 2) return;
                              const minutes = Number(parts[0]) * 60 + Number(parts[1]);
                              setTaskModal((prev) => (prev ? Object.assign({}, prev, { startTime: minutes }) : prev));
                            },
                          }),
                          h('span', { className: 'lc-field-hint' }, '日视图按这里的时间排'),
                        )
                      : null,
                    h(
                      'label',
                      { className: 'lc-field' },
                      fieldLabel('任务描述', false),
                      h('textarea', {
                        className: 'lc-textarea',
                        rows: 4,
                        value: taskModal.description,
                        placeholder: '补充任务背景或验收点（可留空）',
                        onChange: (event) =>
                          setTaskModal((prev) => (prev ? Object.assign({}, prev, { description: event.target.value }) : prev)),
                      }),
                    ),
                  )
                : h(
                    React.Fragment,
                    null,
                    h(
                      'label',
                      { className: 'lc-field' },
                      fieldLabel('任务标题（每行一个）', true),
                      h('textarea', {
                        className: 'lc-textarea lc-batch-input',
                        rows: 7,
                        value: taskModal.batchText,
                        placeholder: '一行一个任务标题，最多 100 条',
                        onChange: (event) =>
                          setTaskModal((prev) => (prev ? Object.assign({}, prev, { batchText: event.target.value, batchRows: [] }) : prev)),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'lc-batch-toolbar' },
                      h('span', { className: 'lc-batch-hint' }, '识别后可逐条调整日期'),
                      h(
                        'label',
                        { className: 'lc-batch-cat' },
                        h('span', null, '分类'),
                        h(
                          'select',
                          {
                            className: 'lc-input lc-batch-cat-select',
                            value: taskModal.categoryId || '',
                            onChange: (event) =>
                              setTaskModal((prev) => (prev ? Object.assign({}, prev, { categoryId: event.target.value }) : prev)),
                          },
                          h('option', { value: '' }, '未分类'),
                          categories.map((category) =>
                            h('option', { key: category.id, value: String(category.id) }, category.name),
                          ),
                        ),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'lc-btn lc-btn-sm', onClick: analyzeBatchTasks },
                        '识别',
                      ),
                    ),
                    taskModal.batchRows.length
                      ? h(
                          'div',
                          { className: 'lc-batch-rows' },
                          taskModal.batchRows.map((row) =>
                            h(
                              'div',
                              { key: row.key, className: 'lc-batch-row' },
                              h('span', { className: 'lc-batch-index' }, String(taskModal.batchRows.indexOf(row) + 1)),
                              h(
                                'input',
                                {
                                  className: 'lc-input',
                                  value: row.title,
                                  onChange: (event) => {
                                    const value = event.target.value;
                                    setTaskModal((prev) =>
                                      prev
                                        ? Object.assign({}, prev, {
                                            batchRows: prev.batchRows.map((item) => (item.key === row.key ? Object.assign({}, item, { title: value }) : item)),
                                          })
                                        : prev,
                                    );
                                  },
                                },
                              ),
                              h('input', {
                                className: 'lc-input lc-batch-date',
                                type: 'date',
                                value: row.deadline,
                                onChange: (event) => {
                                  const value = event.target.value;
                                  setTaskModal((prev) =>
                                    prev
                                      ? Object.assign({}, prev, {
                                          batchRows: prev.batchRows.map((item) => (item.key === row.key ? Object.assign({}, item, { deadline: value }) : item)),
                                        })
                                      : prev,
                                  );
                                },
                              }),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'lc-icon-btn',
                                  title: '移除',
                                  onClick: () =>
                                    setTaskModal((prev) =>
                                      prev ? Object.assign({}, prev, { batchRows: prev.batchRows.filter((item) => item.key !== row.key) }) : prev,
                                    ),
                                },
                                h(GlyphIcon, { name: 'trash', size: 15 }),
                              ),
                            ),
                          ),
                        )
                      : null,
                  ),
              taskModal.error ? h('div', { className: 'lc-modal-error' }, taskModal.error) : null,
            ),
            h(
              'div',
              { className: 'lc-modal-foot' },
              h('button', { type: 'button', className: 'lc-btn', onClick: close }, '取消'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'lc-btn lc-btn-primary',
                  disabled: taskModal.saving,
                  onClick: submitTaskModal,
                },
                taskModal.saving
                  ? '保存中…'
                  : !single
                    ? '确认创建（' + (taskModal.batchRows || []).filter((row) => String(row.title || '').trim()).length + ' 条）'
                    : '确定',
              ),
            ),
          ),
        );
      };

      const resizeTaskColumn = (which) => (event) => {
        event.preventDefault();
        const wrap = tasksWrapRef.current;
        if (!wrap) return;
        const total = wrap.getBoundingClientRect().width;
        const startX = event.clientX;
        const startSide = taskCols.side;
        const startDetail = taskCols.detail;
        const minSide = 168;
        const maxSide = Math.max(minSide, Math.min(320, total - startDetail - 360 - 10));
        const minDetail = 300;
        const maxDetail = Math.max(minDetail, Math.min(620, total - startSide - 360 - 10));
        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX;
          if (which === 'side') {
            setTaskCols((prev) => Object.assign({}, prev, { side: clamp(startSide + delta, minSide, maxSide) }));
          } else {
            setTaskCols((prev) => Object.assign({}, prev, { detail: clamp(startDetail - delta, minDetail, maxDetail) }));
          }
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.body.classList.remove('lc-col-resizing');
        };
        document.body.classList.add('lc-col-resizing');
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      };

      const nudgeTaskColumn = (which, delta) => {
        const wrap = tasksWrapRef.current;
        const total = wrap ? wrap.getBoundingClientRect().width : 0;
        setTaskCols((prev) => {
          if (which === 'side') {
            const maxSide = total ? Math.max(168, Math.min(320, total - prev.detail - 360 - 10)) : 320;
            return Object.assign({}, prev, { side: clamp(prev.side + delta, 168, maxSide) });
          }
          const maxDetail = total ? Math.max(300, Math.min(620, total - prev.side - 360 - 10)) : 620;
          return Object.assign({}, prev, { detail: clamp(prev.detail + delta, 300, maxDetail) });
        });
      };

      const resizeDayDetail = (event) => {
        event.preventDefault();
        const wrap = dayViewRef.current;
        if (!wrap) return;
        const total = wrap.getBoundingClientRect().width;
        const startX = event.clientX;
        const startWidth = dayDetailW;
        const minWidth = 240;
        const maxWidth = Math.max(minWidth, Math.min(520, total - 360 - 5));
        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX;
          setDayDetailW(clamp(startWidth - delta, minWidth, maxWidth));
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.body.classList.remove('lc-col-resizing');
        };
        document.body.classList.add('lc-col-resizing');
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      };

      const nudgeDayDetail = (delta) => {
        const wrap = dayViewRef.current;
        const total = wrap ? wrap.getBoundingClientRect().width : 0;
        const maxWidth = total ? Math.max(240, Math.min(520, total - 360 - 5)) : 520;
        setDayDetailW((prev) => clamp(prev + delta, 240, maxWidth));
      };

      const renderTasksPage = () => {
        const today = todayKey();
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = dateKeyOf(tomorrowDate);
        const weekEndDate = new Date();
        weekEndDate.setDate(weekEndDate.getDate() + 6);
        const weekEnd = dateKeyOf(weekEndDate);
        const currentYear = new Date().getFullYear();
        const shortDate = (deadline) => {
          if (!deadline) return '未设置';
          if (deadline === today) return '今天';
          if (deadline === tomorrow) return '明天';
          const date = new Date(deadline + 'T00:00:00');
          if (Number.isNaN(date.getTime())) return deadline;
          return date.getMonth() + 1 + '月' + date.getDate() + '日';
        };
        const groupLabel = (deadline) => {
          if (!deadline) return '未设置日期';
          if (deadline === today) return '今天';
          if (deadline === tomorrow) return '明天';
          const date = new Date(deadline + 'T00:00:00');
          if (Number.isNaN(date.getTime())) return deadline;
          const week = '日一二三四五六'[date.getDay()];
          const year = date.getFullYear() === currentYear ? '' : date.getFullYear() + '年';
          return year + (date.getMonth() + 1) + '月' + date.getDate() + '日 周' + week;
        };
        const matches = (task, filter) => {
          if (filter === 'done') return Boolean(task.done);
          if (filter === 'today') return task.deadline === today;
          if (task.done) return false;
          if (filter === 'tomorrow') return task.deadline === tomorrow;
          if (filter === 'next7') return task.deadline >= today && task.deadline <= weekEnd;
          return true;
        };
        const allTasks = myTasks.tasks || [];
        const countFor = (filter) =>
          allTasks.filter(
            (task) =>
              matches(task, filter) &&
              (filter === 'done' || (!task.done && !isDroppedStatus(task.status))),
          ).length;
        const currentFilter = TASK_FILTERS.find((item) => item.key === taskFilter) || TASK_FILTERS[0];
        const selectedCategory =
          taskCategoryId && taskCategoryId !== 'none'
            ? categories.find((category) => String(category.id) === String(taskCategoryId)) || null
            : null;
        const categoryLabel = taskCategoryId === 'none' ? '未分类' : selectedCategory ? selectedCategory.name : '';
        const categoryMatches = (task) => {
          if (!taskCategoryId) return true;
          if (taskCategoryId === 'none') return !task.categoryId;
          return String(task.categoryId || '') === String(taskCategoryId);
        };
        const baseVisible = allTasks.filter((task) => matches(task, currentFilter.key));
        const categoryCount = (key) =>
          baseVisible.filter((task) => {
            if (key === 'none') return !task.categoryId;
            return String(task.categoryId || '') === String(key);
          }).length;
        const hasUncategorized = allTasks.some((task) => !task.categoryId);
        const visible = baseVisible
          .filter(categoryMatches)
          .sort((a, b) => {
            const byDate = String(a.deadline || '9999-12-31').localeCompare(String(b.deadline || '9999-12-31'));
            if (byDate) return byDate;
            const byPriority = (a.priority || 3) - (b.priority || 3);
            if (byPriority) return byPriority;
            return Number(a.id) - Number(b.id);
          });
        const openCount = allTasks.filter((task) => !task.done && !isDroppedStatus(task.status)).length;
        const todayCount = allTasks.filter(
          (task) => !task.done && !isDroppedStatus(task.status) && task.deadline === today,
        ).length;
        const groups = [];
        const groupIndex = new Map();
        const activeVisible = visible.filter(
          (task) => !isDroppedStatus(task.status) && (currentFilter.key === 'done' || !task.done),
        );
        const doneVisible = visible.filter((task) => !isDroppedStatus(task.status) && task.done);
        const droppedVisible = visible.filter((task) => isDroppedStatus(task.status));
        for (const task of activeVisible) {
          const label = groupLabel(task.deadline);
          if (!groupIndex.has(label)) {
            groupIndex.set(label, groups.length);
            groups.push({ label, dateKey: task.deadline || '', tasks: [] });
          }
          groups[groupIndex.get(label)].tasks.push(task);
        }
        // 今天视图保留刚完成的任务，单独收进「已完成」组，避免勾选后直接从列表消失。
        if (doneVisible.length && currentFilter.key !== 'done') {
          groups.push({ label: '已完成', dateKey: '__done__', tasks: doneVisible, done: true });
        }
        // 已放弃始终单独一组，放在所有日期分组之后；只收当前筛选命中的任务。
        if (droppedVisible.length) {
          groups.push({ label: '已放弃', dateKey: '__dropped__', tasks: droppedVisible, dropped: true });
        }
        const submitQuickTask = async (event) => {
          if (event.key !== 'Enter') return;
          if (event.nativeEvent && event.nativeEvent.isComposing) return;
          const rawTitle = quickTitle.trim();
          if (!rawTitle || quickSaving) return;
          const parsed = parseTaskDateText(rawTitle, today);
          const timeParsed = parseTaskTimeText(parsed.title);
          const title = timeParsed.title;
          const startTime = timeParsed.startTime;
          const deadline = parsed.date || (currentFilter.key === 'tomorrow' ? tomorrow : today);
          setQuickSaving(true);
          try {
            const quickCategory =
              taskCategoryId === 'none'
                ? null
                : selectedCategory
                  ? selectedCategory.id
                  : categories && categories[0]
                    ? categories[0].id
                    : null;
            const payload = {
              title,
              priority: 3,
              deadline,
              categoryId: quickCategory,
            };
            if (startTime != null) {
              payload.startTime = startTime;
              payload.estimate = 0.5;
            }
            const res = await api('/calendar/api/task-create', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            setQuickTitle('');
            expandTaskGroups([deadline]);
            if (startTime != null && res.task) {
              setCalendarDayTimes((prev) => Object.assign({}, prev, { [String(res.task.id)]: Number(startTime) }));
            }
            await loadMyTasks();
            loadCategories();
            if (res.task) loadDayTaskDetail(res.task.id, res.task);
            if (parsed.date) {
              showNotice('已创建到 ' + shortDate(deadline) + (startTime != null ? ' ' + clockText(startTime) : ''), 'success');
            } else if (startTime != null) {
              showNotice('已创建 ' + clockText(startTime), 'success');
            }
          } catch (error) {
            showNotice(error.message);
          } finally {
            setQuickSaving(false);
          }
        };
        const beginTaskListDrag = (event, task) => {
          if (event.target.closest('input, button, select, textarea, a')) {
            event.preventDefault();
            return;
          }
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(task.id));
          }
          setTaskDragSource({ id: String(task.id), dateKey: task.deadline || '' });
        };
        const overTaskListRow = (event, task) => {
          if (!taskDragSource || taskDragSource.dateKey !== (task.deadline || '')) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
          setTaskDragTarget((prev) =>
            prev && prev.id === String(task.id) && prev.dateKey === (task.deadline || '') && prev.side === side
              ? prev
              : { id: String(task.id), dateKey: task.deadline || '', side },
          );
        };
        const dropTaskListRow = (event, task, groupTasks) => {
          event.preventDefault();
          const source = taskDragSource;
          const dateKey = task.deadline || '';
          const rect = event.currentTarget.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          setTaskDragSource(null);
          setTaskDragTarget(null);
          if (!source || source.dateKey !== dateKey || String(source.id) === String(task.id)) return;
          reorderTaskList(dateKey, source.id, task.id, before, groupTasks);
        };
        const endTaskListDrag = () => {
          setTaskDragSource(null);
          setTaskDragTarget(null);
        };
        const renderRow = (task, dateKey, groupTasks) =>
          h(
            'div',
            {
              key: task.id,
              className:
                'lc-task-row' +
                (task.done ? ' lc-task-row-done' : '') +
                (dayTaskId && String(dayTaskId) === String(task.id) ? ' lc-task-row-active' : '') +
                (taskDragSource && taskDragSource.id === String(task.id) ? ' lc-task-row-dragging' : '') +
                (taskDragTarget && taskDragTarget.id === String(task.id)
                  ? ' lc-task-row-drop-' + taskDragTarget.side
                  : '') +
                (task.categoryId ? ' lc-task-row-cat' : ''),
              style: task.categoryId ? taskCategoryStyle(task) : undefined,
              draggable: true,
              onDragStart: (event) => beginTaskListDrag(event, task),
              onDragEnd: endTaskListDrag,
              onDragOver: (event) => overTaskListRow(event, task),
              onDrop: (event) => dropTaskListRow(event, task, groupTasks),
              onClick: () => loadDayTaskDetail(task.id, task),
              onContextMenu: (event) => openCalendarStatusMenu(event, task),
            },
            isDroppedStatus(task.status)
              ? h(
                  'span',
                  {
                    className: 'lc-task-check lc-task-check-dropped',
                    title: '已放弃',
                    'aria-label': '已放弃：' + task.title,
                    onClick: (event) => event.stopPropagation(),
                  },
                  h(DroppedCross),
                )
              : h('input', {
                  type: 'checkbox',
                  className: 'lc-task-check',
                  checked: Boolean(task.done),
                  disabled: completingTasks.includes(task.id),
                  title: task.done ? '取消完成，回到未开始' : '标记完成',
                  'aria-label': (task.done ? '取消完成：' : '标记完成：') + task.title,
                  onClick: (event) => event.stopPropagation(),
                  onChange: () => completeTask(task),
                }),
            h('div', { className: 'lc-task-row-title', title: task.title }, task.title),
            h(TomatoMarks, { count: task.pomodoroCount, max: 4 }),
            h(
              'div',
              { className: 'lc-task-row-meta' },
              h('span', { className: 'lc-task-pri lc-task-pri-' + (task.priority || 3) }, 'P' + (task.priority || 3)),
              h(
                'span',
                { className: 'lc-task-row-date' },
                shortDate(task.deadline) +
                  (task.startTime !== null && task.startTime !== undefined ? ' ' + clockText(task.startTime) : ''),
              ),
            ),
          );
        return h(
          'div',
          { className: 'lc-task-page' },
          h(
            'header',
            { className: 'lc-task-top' },
            h(
              'div',
              { className: 'lc-task-top-main' },
              h('div', { className: 'lc-task-top-title' }, '任务'),
              h('div', { className: 'lc-task-top-sub' }, currentFilter.label + (categoryLabel ? ' · ' + categoryLabel : ' · 按日期整理')),
            ),
            h(
              'div',
              { className: 'lc-task-top-stats' },
              h('span', null, h('b', null, String(openCount)), '未完成'),
              h('span', null, h('b', null, String(todayCount)), '今天'),
            ),
          ),
          h(
            'div',
            {
              className: 'lc-tasks',
              ref: tasksWrapRef,
              style: { '--lc-side-w': taskCols.side + 'px', '--lc-detail-w': taskCols.detail + 'px' },
            },
          h(
            'aside',
            { className: 'lc-task-side' },
            h('div', { className: 'lc-task-side-title' }, '清单'),
            h(
              'nav',
              { className: 'lc-task-side-nav' },
              TASK_FILTERS.map((filter) =>
                h(
                  'button',
                  {
                    key: filter.key,
                    type: 'button',
                    className: 'lc-task-side-item' + (filter.key === currentFilter.key ? ' lc-task-side-item-active' : ''),
                    onClick: () => setTaskFilter(filter.key),
                  },
                  h('span', { className: 'lc-task-side-icon' }, h(GlyphIcon, { name: filter.icon, size: 16 })),
                  h('span', { className: 'lc-task-side-label' }, filter.label),
                  h('span', { className: 'lc-task-side-count' }, String(countFor(filter.key))),
                ),
              ),
            ),
            h('div', { className: 'lc-task-side-title lc-task-side-title-cats' }, '分类'),
            h(
              'nav',
              { className: 'lc-task-side-nav lc-task-cat-nav' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'lc-task-side-item' + (!taskCategoryId ? ' lc-task-side-item-active' : ''),
                  onClick: () => setTaskCategoryId(null),
                },
                h('span', { className: 'lc-task-cat-dot lc-task-cat-dot-all' }),
                h('span', { className: 'lc-task-side-label' }, '全部'),
                h('span', { className: 'lc-task-side-count' }, String(baseVisible.length)),
              ),
              categories.map((category) =>
                h(
                  'button',
                  {
                    key: category.id,
                    type: 'button',
                    className:
                      'lc-task-side-item' +
                      (String(taskCategoryId) === String(category.id) ? ' lc-task-side-item-active' : ''),
                    onClick: () =>
                      setTaskCategoryId((prev) =>
                        String(prev) === String(category.id) ? null : String(category.id),
                      ),
                  },
                  h('span', {
                    className: 'lc-task-cat-dot',
                    style: { background: category.color },
                  }),
                  h('span', { className: 'lc-task-side-label' }, category.name),
                  h('span', { className: 'lc-task-side-count' }, String(categoryCount(category.id))),
                ),
              ),
              hasUncategorized
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'lc-task-side-item' + (taskCategoryId === 'none' ? ' lc-task-side-item-active' : ''),
                      onClick: () =>
                        setTaskCategoryId((prev) => (prev === 'none' ? null : 'none')),
                    },
                    h('span', { className: 'lc-task-cat-dot lc-task-cat-dot-none' }),
                    h('span', { className: 'lc-task-side-label' }, '未分类'),
                    h('span', { className: 'lc-task-side-count' }, String(categoryCount('none'))),
                  )
                : null,
            ),
          ),
          h(
            'div',
            {
              className: 'lc-split',
              role: 'separator',
              'aria-orientation': 'vertical',
              'aria-label': '调整任务列表宽度',
              tabIndex: 0,
              title: '拖动调整任务列表宽度',
              onPointerDown: resizeTaskColumn('side'),
              onKeyDown: (event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  nudgeTaskColumn('side', event.key === 'ArrowLeft' ? -10 : 10);
                }
              },
            },
            h('span', { className: 'lc-split-grip' }),
          ),
          h(
            'section',
            { className: 'lc-task-main' },
            currentFilter.key === 'done'
              ? null
              : h(
                  'label',
                  { className: 'lc-task-add' },
                  h(GlyphIcon, { name: 'plus', size: 17 }),
                  h('input', {
                    type: 'text',
                    value: quickTitle,
                    placeholder: '添加任务，可带日期时间，如「明天上午9点开会」',
                    disabled: quickSaving,
                    onChange: (event) => setQuickTitle(event.target.value),
                    onKeyDown: submitQuickTask,
                  }),
                ),
            visible.length
              ? groups.map((group) => {
                  const ordered = orderedTasksFor(group.tasks, group.dateKey);
                  const groupKey = group.dropped ? '__dropped__' : group.done ? '__done__' : group.dateKey || '__nodate__';
                  const collapsed = !!collapsedGroups[groupKey];
                  const toggleGroup = () =>
                    setCollapsedGroups((prev) => {
                      const next = Object.assign({}, prev);
                      if (next[groupKey]) delete next[groupKey];
                      else next[groupKey] = true;
                      return next;
                    });
                  return h(
                    'div',
                    { key: group.label, className: 'lc-task-group' + (group.dropped ? ' lc-task-group-dropped' : '') + (group.done ? ' lc-task-group-done' : '') },
                    h(
                      'div',
                      {
                        className: 'lc-task-group-head' + (collapsed ? ' is-collapsed' : ''),
                        role: 'button',
                        tabIndex: 0,
                        'aria-expanded': collapsed ? 'false' : 'true',
                        title: collapsed ? '展开分组' : '折叠分组',
                        onClick: toggleGroup,
                        onKeyDown: (event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          toggleGroup();
                        },
                      },
                      h('span', { className: 'lc-task-group-arrow' }, h(GlyphIcon, { name: collapsed ? 'chevron-right' : 'chevron-down', size: 13 })),
                      h('span', { className: 'lc-task-group-label' }, group.label),
                      h('b', null, String(group.tasks.length)),
                    ),
                    collapsed ? null : ordered.map((task) => renderRow(task, group.dateKey, ordered)),
                  );
                })
              : h('div', { className: 'lc-task-empty' }, myTasks.loading ? '加载中…' : currentFilter.key === 'done' ? '还没有已完成的任务' : categoryLabel ? '这个分类下没有任务' : '这个列表是空的，在上方输入任务标题并回车即可添加'),
          ),
          h(
            'div',
            {
              className: 'lc-split',
              role: 'separator',
              'aria-orientation': 'vertical',
              'aria-label': '调整任务详情宽度',
              tabIndex: 0,
              title: '拖动调整任务详情宽度',
              onPointerDown: resizeTaskColumn('detail'),
              onKeyDown: (event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  nudgeTaskColumn('detail', event.key === 'ArrowLeft' ? -10 : 10);
                }
              },
            },
            h('span', { className: 'lc-split-grip' }),
          ),
          renderDayDetail(null),
          ),
        );
      };

      summaryNoteRef.current = summaryNote;

      const persistSummaryNote = async (content, periodKey) => {
        if (!periodKey) return;
        setSummaryNote((prev) => (prev.periodKey === periodKey ? { ...prev, saving: true, error: '' } : prev));
        try {
          const data = await api('/calendar/api/reflection', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ periodKey, content }),
          });
          const saved = String((data.reflection && data.reflection.content) || '');
          setSummaryNote((prev) =>
            prev.periodKey === periodKey ? { ...prev, saved, saving: false, error: '' } : prev,
          );
        } catch (error) {
          setSummaryNote((prev) =>
            prev.periodKey === periodKey
              ? { ...prev, saving: false, error: error.message || '感想保存失败' }
              : prev,
          );
        }
      };

      const flushSummaryNote = (content) => {
        if (summaryNoteTimer.current) {
          clearTimeout(summaryNoteTimer.current);
          summaryNoteTimer.current = null;
        }
        const note = summaryNoteRef.current;
        if (!note || !note.periodKey || note.loading || note.saving) return;
        const text = typeof content === 'string' ? content : note.content;
        if (text === note.saved) return;
        void persistSummaryNote(text, note.periodKey);
      };

      const changeSummaryNote = (event) => {
        const content = event.target.value;
        const periodKey = summaryNoteRef.current && summaryNoteRef.current.periodKey;
        if (!periodKey) return;
        setSummaryNote((prev) => (prev.periodKey === periodKey ? { ...prev, content, error: '' } : prev));
        if (summaryNoteTimer.current) clearTimeout(summaryNoteTimer.current);
        summaryNoteTimer.current = setTimeout(() => {
          summaryNoteTimer.current = null;
          void persistSummaryNote(content, periodKey);
        }, 650);
      };

      const renderSummaryPage = () => {
        const today = todayKey();
        const modeMeta = SUMMARY_MODES.find((item) => item.key === summaryMode) || SUMMARY_MODES[1];
        const period = summaryPeriod(summaryMode, summaryAnchor);
        const notePeriodKey = summaryMode + ':' + period.startKey;
        const note = summaryNote.periodKey === notePeriodKey
          ? summaryNote
          : { periodKey: notePeriodKey, content: '', saved: '', loading: true, saving: false, error: '' };
        const noteStateText = note.error
          ? '保存失败'
          : note.loading
            ? '读取中…'
            : note.saving
              ? '保存中…'
              : note.content !== note.saved
                ? '待保存…'
                : note.saved
                  ? '已保存'
                  : '自动保存';
        const noteStateClass = note.error
          ? ' is-error'
          : note.saving || note.content !== note.saved
            ? ' is-saving'
            : note.saved
              ? ' is-saved'
              : '';
        const noteHint = summaryMode === 'day' ? '写给这一天' : summaryMode === 'week' ? '写给这一周' : '写给这个月';
        const allTasks = myTasks.tasks || [];
        const periodTasks = allTasks.filter(
          (task) => task.deadline && task.deadline >= period.startKey && task.deadline <= period.endKey,
        );
        const dateOf = (key) => new Date(key + 'T00:00:00');
        const monthDay = (key) => {
          const date = dateOf(key);
          return date.getMonth() + 1 + '月' + date.getDate() + '日';
        };
        const weekdayOf = (key) => '日一二三四五六'[dateOf(key).getDay()];
        const startDate = dateOf(period.startKey);
        const endDate = dateOf(period.endKey);
        const periodLabel =
          summaryMode === 'day'
            ? startDate.getFullYear() + '年' + monthDay(period.startKey) + ' 周' + weekdayOf(period.startKey)
            : summaryMode === 'month'
              ? startDate.getFullYear() + '年' + (startDate.getMonth() + 1) + '月'
              : startDate.getFullYear() === endDate.getFullYear()
                ? startDate.getFullYear() + '年' + monthDay(period.startKey) + ' – ' + monthDay(period.endKey)
                : startDate.getFullYear() + '年' + monthDay(period.startKey) + ' – ' +
                  endDate.getFullYear() + '年' + monthDay(period.endKey);
        const scopeWord = summaryMode === 'day' ? '今天' : summaryMode === 'week' ? '本周' : '本月';
        const unit = modeMeta.unit;

        const total = periodTasks.length;
        const doneT = periodTasks.filter((task) => task.done).length;
        const droppedT = periodTasks.filter((task) => isDroppedStatus(task.status)).length;
        const openT = total - doneT - droppedT;
        const effectiveT = total - droppedT;
        const rate = effectiveT ? Math.round((doneT / effectiveT) * 100) : 0;
        const overdue = periodTasks.filter(
          (task) => !task.done && !isDroppedStatus(task.status) && task.deadline < today,
        ).length;
        const p1Tasks = periodTasks.filter((task) => Number(task.priority) === 1);
        const p1Done = p1Tasks.filter((task) => task.done).length;
        const p1Total = p1Tasks.length;
        const focusData =
          summaryFocus.data &&
          summaryFocus.data.from === period.startKey &&
          summaryFocus.data.to === period.endKey
            ? summaryFocus.data
            : null;
        const focusTotals = (focusData && focusData.totals) || { sessions: 0, seconds: 0, tomatoes: 0 };
        const focusByDay = new Map(((focusData && focusData.days) || []).map((day) => [day.date, day]));
        const focusMax = Math.max(1, ...((focusData && focusData.days) || []).map((day) => day.seconds));
        const focusKnown = !summaryFocus.loading && !summaryFocus.error;
        const focusLine = focusTotals.seconds
          ? focusTotals.tomatoes
            ? scopeWord +
              '完成 ' +
              focusTotals.tomatoes +
              ' 个番茄，累计专注 ' +
              formatDuration(focusTotals.seconds) +
              (focusTotals.sessions ? '，共 ' + focusTotals.sessions + ' 次专注。' : '。')
            : scopeWord +
              '累计专注 ' +
              formatDuration(focusTotals.seconds) +
              (focusTotals.sessions ? '，共 ' + focusTotals.sessions + ' 次专注。' : '。')
          : '';

        const taskRank = (task) => (task.done ? 0 : isDroppedStatus(task.status) ? 2 : 1);
        const sortTask = (a, b) =>
          taskRank(a) - taskRank(b) ||
          Number(a.priority || 3) - Number(b.priority || 3) ||
          String(a.title).localeCompare(String(b.title), 'zh-Hans-CN');
        const grouped = new Map(period.days.map((key) => [key, []]));
        periodTasks.forEach((task) => {
          if (grouped.has(task.deadline)) grouped.get(task.deadline).push(task);
        });
        const daily = period.days.map((key) => {
          const list = (grouped.get(key) || []).slice().sort(sortTask);
          const done = list.filter((task) => task.done).length;
          const dropped = list.filter((task) => isDroppedStatus(task.status)).length;
          const effective = list.length - dropped;
          return {
            key,
            list,
            done,
            dropped,
            total: list.length,
            effective,
            rate: effective ? Math.round((done / effective) * 100) : 0,
          };
        });
        const activeDays = daily.filter((day) => day.total > 0);
        const bestDay = activeDays
          .slice()
          .sort((a, b) => b.done - a.done || b.rate - a.rate)[0];
        const worstDay = activeDays
          .filter((day) => day.effective > 0 && day.done < day.effective)
          .slice()
          .sort((a, b) => a.rate - b.rate)[0];
        const openTasks = periodTasks
          .filter((task) => !task.done && !isDroppedStatus(task.status))
          .sort(
            (a, b) =>
              Number(a.priority || 3) - Number(b.priority || 3) ||
              String(a.deadline).localeCompare(String(b.deadline)),
          );
        const shortTitle = (task) =>
          task && task.title.length > 18 ? task.title.slice(0, 18) + '…' : task ? task.title : '';

        const doneTasks = periodTasks.filter((task) => task.done);
        const contentDoneGroups = groupTasksByTheme(doneTasks);
        const contentOpenGroups = groupTasksByTheme(openTasks);
        const contentDroppedGroups = groupTasksByTheme(
          periodTasks.filter((task) => isDroppedStatus(task.status)),
        );
        const contentThemeCounts = new Map();
        const mainPool = periodTasks.filter((task) => !isDroppedStatus(task.status));
        (mainPool.length ? mainPool : periodTasks).forEach((task) => {
          const theme = taskThemeOf(task);
          contentThemeCounts.set(theme, (contentThemeCounts.get(theme) || 0) + 1);
        });
        const contentMain = Array.from(contentThemeCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([theme]) => theme)
          .slice(0, 2);
        const contentLineOf = (groups) =>
          groups
            .map(
              (group) =>
                group.theme +
                '：' +
                group.list.slice(0, 2).map(shortTitle).join('、') +
                (group.list.length > 2 ? ' 等' : ''),
            )
            .join('；');
        const contentPlain = total
          ? '主线：' + contentMain.join('、') +
            (doneT ? '\n已完成 · ' + contentLineOf(contentDoneGroups) : '') +
            (openT ? '\n待推进 · ' + contentLineOf(contentOpenGroups) : '') +
            (droppedT ? '\n已放下 · ' + contentLineOf(contentDroppedGroups) : '')
          : '';

        const statusLine =
          rate >= 80
            ? '整体推进扎实，重点事项基本落地。'
            : rate >= 50
              ? '节奏总体可控，仍有收尾空间。'
              : summaryMode === 'day'
                ? '今天先把任务摆清楚，明天从一件小事重新启动。'
                : summaryMode === 'month'
                  ? '这个月更像是在铺路，方向理顺也是进展。'
                  : '这个周期更像是在铺路，方向理顺也是进展。';
        const openings = total
          ? [
              periodLabel + '，你共安排 ' + total + ' 项任务，完成 ' + doneT + ' 项，完成率 ' + rate + '%。' + statusLine,
              scopeWord + '的任务盘点是 ' + total + ' 项，其中 ' + doneT + ' 项已经落地，完成率 ' + rate + '%。' + statusLine,
              '从 ' + total + ' 项任务里完成 ' + doneT + ' 项，完成率 ' + rate + '%。' + statusLine,
            ]
          : [periodLabel + '没有安排任务。留白也是节奏的一部分，先把精力留给真正重要的事。'];
        const opening = openings[summarySeed % openings.length];

        const keep = [];
        if (!total) {
          keep.push('没有硬塞任务，给精力留出了恢复空间。');
        } else if (summaryMode === 'day') {
          if (doneT > 0) {
            keep.push('今天完成 ' + doneT + ' 项，完成率 ' + rate + '%，节奏保持得不错。');
          } else {
            keep.push('今天先把 ' + total + ' 项任务摆上台面，明确重点本身就是推进的起点。');
          }
          if (p1Total && p1Done > 0) {
            keep.push('P1 关键任务完成 ' + p1Done + '/' + p1Total + (p1Done === p1Total ? '，重点没有失速。' : '，关键事项已经启动。'));
          }
          if (focusKnown && focusTotals.tomatoes > 0) {
            keep.push(
              '今天完成 ' + focusTotals.tomatoes + ' 个番茄，累计专注 ' +
                formatDuration(focusTotals.seconds) + '，深度工作有实际投入。',
            );
          } else if (focusKnown && focusTotals.seconds > 0) {
            keep.push('今天累计专注 ' + formatDuration(focusTotals.seconds) + '，已经有深度工作的实际投入。');
          }
        } else {
          const scopeNoun = summaryMode === 'week' ? '这周' : '本月';
          if (doneT === total) keep.push('安排的任务全部完成，计划与执行基本对齐。');
          else if (bestDay && bestDay.done >= 2) keep.push('「' + monthDay(bestDay.key) + ' 周' + weekdayOf(bestDay.key) + '」完成 ' + bestDay.done + ' 项，是' + scopeNoun + '最稳的一天。');
          else if (bestDay && bestDay.done > 0) keep.push('「' + monthDay(bestDay.key) + ' 周' + weekdayOf(bestDay.key) + '」完成了' + scopeNoun + '的第一项，启动惯性已经建立。');
          if (p1Total && p1Done > 0) {
            keep.push('P1 关键任务完成 ' + p1Done + '/' + p1Total + (p1Done === p1Total ? '，重点没有失速。' : '，关键事项已经启动。'));
          }
          if (droppedT) keep.push('主动放弃 ' + droppedT + ' 项，把注意力留给更重要的事。');
          if (focusKnown && focusTotals.tomatoes > 0) {
            keep.push(
              scopeWord + '完成 ' + focusTotals.tomatoes + ' 个番茄，累计专注 ' +
                formatDuration(focusTotals.seconds) + '，重要事项有持续的深度投入。',
            );
          } else if (focusKnown && focusTotals.seconds > 0) {
            keep.push(scopeWord + '累计专注 ' + formatDuration(focusTotals.seconds) + '，已经有深度工作的实际投入。');
          }
          if (!keep.length) keep.push('已经完成 ' + doneT + ' 项，先把进度保留下来，再谈优化。');
        }

        const improve = [];
        if (!total) {
          improve.push('可以提前给下个周期留一个“最重要的事”，避免节奏断档。');
        } else {
          if (overdue) {
            improve.push('有 ' + overdue + ' 项任务已逾期，先处理「' + shortTitle(openTasks[0]) + '」，避免继续滚动。');
          }
          if (worstDay) {
            improve.push(
              '「' + monthDay(worstDay.key) + '」完成 ' + worstDay.done + '/' + worstDay.effective +
                '，完成率 ' + worstDay.rate + '%，' +
                (worstDay.effective >= 3 ? '当天任务密度偏高。' : '任务可能卡在启动阶段。'),
            );
          }
          if (p1Total && p1Done < p1Total) {
            improve.push('P1 关键任务还有 ' + (p1Total - p1Done) + ' 项未完成，建议先锁定一个固定时段推进。');
          }
          if (openT >= 2 && contentOpenGroups.length > 1) {
            improve.push(
              '待推进项横跨' +
                contentOpenGroups.slice(0, 2).map((group) => group.theme).join('、') +
                '，建议按主题集中处理，减少来回切换。',
            );
          }
          if (focusKnown && !focusTotals.seconds && openT > 0) {
            improve.push(
              scopeWord + '有任务待推进，但没有番茄记录；可以用一个 25 分钟番茄启动最重要的一项。',
            );
          }
          if (!improve.length && openT) {
            improve.push('还有 ' + openT + ' 项待推进，建议先明确下一步动作，避免停留在“待开始”。');
          }
          if (!improve.length) {
            improve.push('完成率已经稳定，下一步可以关注任务颗粒度与重要度，而不是继续加量。');
          }
        }

        const start = [];
        if (openTasks[0]) {
          start.push(
            focusTotals.tomatoes === 0
              ? '给「' + shortTitle(openTasks[0]) + '」安排一个 25 分钟番茄，只推进第一步。'
              : '给「' + shortTitle(openTasks[0]) + '」再留一个 25 分钟番茄，把下一步做完。',
          );
        }
        if (openTasks.length > 1) {
          start.push('把剩余任务拆成 30 分钟内可推进的小步，降低启动成本。');
        } else if (!total) {
          start.push('下个周期先定 1 件最重要的小事，完成后再扩展。');
        }
        if (start.length < 2) {
          start.push('每天结束前用 2 分钟更新任务状态，让复盘建立在真实数据上。');
        }
        if (start.length < 2) {
          start.push('给下个周期留一个明确的重点，不要用更多任务填满时间。');
        }

        const stop = [];
        if (overdue) stop.push('停止让逾期任务自动滚到下一个周期，到期就重排、拆解或放弃。');
        if (openT >= 3 || (worstDay && worstDay.effective >= 3 && worstDay.rate < 60)) {
          stop.push('停止在同一天堆叠 3 项以上高优任务，给计划留 10% 缓冲。');
        }
        if (droppedT >= 3) stop.push('停止用“先记下来”代替排期，收集箱也需要定期清空。');
        if (!stop.length) stop.push('停止用完成数量衡量全部价值，重要任务的推进质量更值得关注。');
        if (stop.length < 2 && openT >= 3) {
          stop.push('停止同时推进过多事项，把注意力收拢到最重要的 1–2 件。');
        }

        const closing = !total
          ? '留白也是节奏的一部分。等状态回来，从一件最重要的小事开始。'
          : summaryMode === 'day'
            ? rate >= 80
              ? '今天收得很干净，保持这个节奏，明天给计划留一点缓冲。复盘不是挑错，是让下一次更省力。'
              : rate >= 50
                ? '今天完成了大半，明天优先收口剩下的关键事项。复盘不是挑错，是让下一次更省力。'
                : '今天更像是在铺路，先把方向理顺也是进展。明天从一件小事重新起跑。'
            : rate >= 80
              ? '整体节奏在线，保持这个势头，同时给计划留一点缓冲。复盘不是挑错，是让下一次更省力。'
              : rate >= 50
                ? '进度在可控范围内，下个周期把注意力收拢到最重要的 1–2 件事上。复盘不是挑错，是让下一次更省力。'
                : summaryMode === 'month'
                  ? '这个月更像是在铺路，先把方向理顺也是进展。下个月从一件小事重新起跑。'
                  : '这个周期更像是在铺路，先把方向理顺也是进展。下个周期从一件小事重新起跑。';

        const kiss = [
          { key: 'keep', letter: 'K', label: '保持', en: 'Keep', items: keep },
          { key: 'improve', letter: 'I', label: '改进', en: 'Improve', items: improve },
          { key: 'start', letter: 'S', label: '开始', en: 'Start', items: start.slice(0, 2) },
          { key: 'stop', letter: 'T', label: '停止', en: 'Stop', items: stop.slice(0, 2) },
        ];

        const summaryText =
          '【' + periodLabel + ' · 工作总结】\n\n' +
          opening + '\n\n' +
          (focusLine ? focusLine + '\n\n' : '') +
          (contentPlain ? '【内容复盘】\n' + contentPlain + '\n\n' : '') +
          kiss
            .map((block) => block.letter + ' ' + block.label + '（' + block.en + '）\n' + block.items.map((line) => '- ' + line).join('\n'))
            .join('\n\n') +
          '\n\n' + closing;

        const copySummary = async () => {
          try {
            await navigator.clipboard.writeText(summaryText);
            showNotice('总结已复制', 'success');
          } catch (error) {
            showNotice('复制失败，请手动选择文本');
          }
        };

        const shiftSummary = (delta) => {
          const date = dateOf(summaryAnchor);
          if (summaryMode === 'day') date.setDate(date.getDate() + delta);
          else if (summaryMode === 'week') date.setDate(date.getDate() + delta * 7);
          else {
            date.setDate(1);
            date.setMonth(date.getMonth() + delta);
          }
          flushSummaryNote();
          setSummaryAnchor(dateKeyOf(date));
        };

        const openTaskFromSummary = (task) => {
          setActiveView('tasks');
          setTaskFilter(task.done ? 'done' : 'inbox');
          loadDayTaskDetail(task.id, task);
        };

        const taskChip = (task) => {
          const dropped = isDroppedStatus(task.status);
          return h(
            'button',
            {
              key: task.id,
              type: 'button',
              className: 'lc-sum-task ' + (task.done ? 'is-done' : dropped ? 'is-dropped' : 'is-open'),
              title: task.title + ' · 点击查看详情',
              onClick: () => openTaskFromSummary(task),
            },
            h('span', { className: 'lc-sum-task-dot' }),
            h('span', { className: 'lc-sum-task-title' }, task.title),
            Number(task.priority) === 1 ? h('span', { className: 'lc-sum-task-pri' }, 'P1') : null,
          );
        };

        const metrics = [
          { label: '任务总数', value: String(total), sub: period.days.length + ' 天', tone: 'brand' },
          { label: '已完成', value: String(doneT), sub: total ? '完成率 ' + rate + '%' : '—', tone: 'success' },
          {
            label: '完成率',
            value: total ? rate + '%' : '—',
            sub: droppedT ? '不含已放弃 ' + droppedT + ' 项' : '按应完成任务计',
            tone: 'brand',
          },
          {
            label: '待推进',
            value: String(openT),
            sub: overdue ? '其中逾期 ' + overdue + ' 项' : '暂无逾期',
            tone: overdue ? 'warning' : 'muted',
          },
        ];

        const listedDays = summaryMode === 'month' ? daily.filter((day) => day.total > 0) : daily;
        const chipLimit = summaryMode === 'day' ? 20 : summaryMode === 'week' ? 6 : 4;
        const renderDayFocus = (key) => {
          const item = focusByDay.get(key);
          return item && item.seconds
            ? h(
                'span',
                { className: 'lc-sum-day-focus' },
                '🍅 ' + item.tomatoes + ' · ' + formatDuration(item.seconds),
              )
            : null;
        };

        const summarySlotsFor = (day) => {
          const slots = new Array(48).fill(null);
          const dayTasks = (day.list || [])
            .filter((task) => !isDroppedStatus(task.status))
            .slice()
            .sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));
          let cursor = 9 * 60;
          dayTasks.forEach((task) => {
            const hasExplicit = task.startTime !== null && task.startTime !== undefined && task.startTime !== '';
            const explicit = hasExplicit ? Number(task.startTime) : NaN;
            const remembered = Number(calendarDayTimes[String(task.id)]);
            const estimateMinutes = Math.max(30, Math.round(((Number(task.estimate) || 1) * 60) / 30) * 30);
            const start =
              Number.isFinite(explicit) && explicit >= 0 && explicit < 24 * 60
                ? Math.floor(explicit / 30) * 30
                : Number.isFinite(remembered) && remembered >= 0 && remembered < 24 * 60
                  ? Math.floor(remembered / 30) * 30
                  : Math.min(23 * 60 + 30, Math.max(0, Math.floor(cursor / 30) * 30));
            const end = Math.min(24 * 60, start + estimateMinutes);
            const first = Math.floor(start / 30);
            const last = Math.ceil(end / 30) - 1;
            for (let slot = first; slot <= last && slot < 48; slot += 1) {
              if (slot >= 0 && !slots[slot]) {
                slots[slot] = {
                  task,
                  color: taskCategoryColor(task),
                  category: task.categoryName || '未分类',
                  start,
                  end,
                };
              }
            }
            cursor = Math.max(cursor, end);
          });
          return slots;
        };

        const renderDay = (day) =>
          h(
            'div',
            {
              key: day.key,
              className:
                'lc-sum-day' +
                (day.key === today ? ' lc-sum-day-today' : '') +
                (day.total ? '' : ' lc-sum-day-empty'),
            },
            h(
              'div',
              { className: 'lc-sum-day-top' },
              h(
                'div',
                { className: 'lc-sum-day-date' },
                h('b', null, monthDay(day.key)),
                h('span', null, '周' + weekdayOf(day.key)),
                day.key === today ? h('em', null, '今天') : null,
              ),
              h(
                'div',
                { className: 'lc-sum-day-count' },
                day.total
                  ? day.effective
                    ? day.done + '/' + day.effective + ' 完成'
                    : '已放弃 ' + day.dropped + ' 项'
                  : '无任务',
                renderDayFocus(day.key),
              ),
            ),
            h(
              'div',
              { className: 'lc-sum-day-bar' },
              h('i', {
                className: day.rate === 100 && day.total ? 'is-full' : '',
                style: { width: (day.effective ? day.rate : 0) + '%' },
              }),
            ),
            h(
              'div',
              { className: 'lc-sum-slots', role: 'img', 'aria-label': monthDay(day.key) + ' 的半小时时间分布' },
              summarySlotsFor(day).map((slot, index) =>
                h('span', {
                  key: index,
                  className:
                    'lc-sum-slot' +
                    (slot ? ' is-filled' : '') +
                    (slot && slot.task.done ? ' is-done' : ''),
                  style: slot ? { backgroundColor: slot.color } : undefined,
                  title:
                    clockText(index * 30) +
                    '–' +
                    clockText((index + 1) * 30) +
                    (slot
                      ? ' · ' +
                        slot.category +
                        ' · ' +
                        slot.task.title +
                        (slot.task.done ? '（已完成）' : '')
                      : ' · 空'),
                }),
              ),
            ),
            day.list.length
              ? h(
                  'div',
                  { className: 'lc-sum-tasks' },
                  day.list.slice(0, chipLimit).map(taskChip),
                  day.list.length > chipLimit
                    ? h('span', { className: 'lc-sum-more' }, '+' + (day.list.length - chipLimit))
                    : null,
                )
              : h('div', { className: 'lc-sum-day-none' }, '没有安排任务'),
          );

        return h(
          'div',
          { className: 'lc-summary' },
          h(
            'header',
            { className: 'lc-summary-head' },
            h(
              'div',
              { className: 'lc-summary-head-title' },
              h('h2', null, '总结'),
              h('p', null, '每日完成情况与 KISS 复盘'),
            ),
            h(
              'div',
              { className: 'lc-summary-head-controls' },
              h(
                'div',
                { className: 'lc-sum-modes', role: 'tablist', 'aria-label': '总结周期' },
                SUMMARY_MODES.map((mode) =>
                  h(
                    'button',
                    {
                      key: mode.key,
                      type: 'button',
                      role: 'tab',
                      'aria-selected': summaryMode === mode.key,
                      className: 'lc-sum-mode-btn' + (summaryMode === mode.key ? ' is-active' : ''),
                      onClick: () => {
                        flushSummaryNote();
                        setSummaryMode(mode.key);
                        setSummarySeed(0);
                      },
                    },
                    mode.label,
                  ),
                ),
              ),
              h(
                'div',
                { className: 'lc-sum-nav' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-sum-nav-btn',
                    title: '上一个周期',
                    'aria-label': '上一个周期',
                    onClick: () => shiftSummary(-1),
                  },
                  h(GlyphIcon, { name: 'chevron-left', size: 16 }),
                ),
                h('span', { className: 'lc-sum-range', title: periodLabel }, periodLabel),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-sum-nav-btn',
                    title: '下一个周期',
                    'aria-label': '下一个周期',
                    onClick: () => shiftSummary(1),
                  },
                  h(GlyphIcon, { name: 'chevron-right', size: 16 }),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-sum-today-btn',
                    onClick: () => {
                      flushSummaryNote();
                      setSummaryAnchor(today);
                    },
                  },
                  '回到今天',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-sum-nav-btn',
                    title: '刷新任务数据',
                    'aria-label': '刷新任务数据',
                    onClick: () => loadMyTasks(),
                  },
                  h(GlyphIcon, { name: 'refresh', size: 15 }),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lc-summary-body' },
            h(
              'div',
              { className: 'lc-summary-inner' },
              myTasks.error
                ? h(
                    'div',
                    { className: 'lc-sum-error' },
                    h('span', null, '任务数据加载失败：' + myTasks.error),
                    h('button', { type: 'button', onClick: () => loadMyTasks() }, '重试'),
                  )
                : null,
              h(
                'section',
                { className: 'lc-sum-metrics' },
                metrics.map((metric) =>
                  h(
                    'div',
                    { key: metric.label, className: 'lc-sum-metric lc-sum-metric-' + metric.tone },
                    h('span', { className: 'lc-sum-metric-label' }, metric.label),
                    h('strong', { className: 'lc-sum-metric-value' }, metric.value),
                    h('span', { className: 'lc-sum-metric-sub' }, metric.sub),
                  ),
                ),
              ),
              h(
                'section',
                { className: 'lc-sum-card lc-sum-focus' },
                h(
                  'div',
                  { className: 'lc-sum-focus-head' },
                  h(
                    'div',
                    { className: 'lc-sum-focus-title' },
                    h('span', { className: 'lc-sum-focus-icon' }, '🍅'),
                    h(
                      'div',
                      null,
                      h('h3', null, '番茄专注'),
                      h(
                        'p',
                        null,
                        summaryMode === 'day'
                          ? '这一天的深度工作记录'
                          : summaryMode === 'week'
                            ? '这一周的深度工作记录'
                            : '这个月的深度工作记录',
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'lc-sum-focus-total' },
                    h('strong', null, String(focusTotals.tomatoes)),
                    h('span', null, '个番茄'),
                    h('em', null, formatDuration(focusTotals.seconds)),
                  ),
                ),
                summaryFocus.loading
                  ? h('div', { className: 'lc-sum-focus-empty' }, '正在读取番茄记录…')
                  : summaryFocus.error
                    ? h(
                        'div',
                        { className: 'lc-sum-focus-empty is-error' },
                        h('span', null, '番茄数据加载失败：' + summaryFocus.error),
                        h(
                          'button',
                          { type: 'button', onClick: () => setSummaryFocusSeed((value) => value + 1) },
                          '重试',
                        ),
                      )
                    : !focusTotals.seconds
                      ? h(
                          'div',
                          { className: 'lc-sum-focus-empty' },
                          '这个周期还没有番茄记录。在任务上右键「开始番茄钟」，完成一个倒计时就会记 1 个番茄。',
                        )
                      : h(
                          'div',
                          { className: 'lc-sum-focus-body' + (summaryMode === 'day' ? ' is-day' : '') },
                          h(
                            'div',
                            { className: 'lc-sum-focus-stats' },
                            h('div', null, h('span', null, '专注时长'), h('b', null, formatDuration(focusTotals.seconds))),
                            h('div', null, h('span', null, '专注次数'), h('b', null, focusTotals.sessions + ' 次')),
                            h(
                              'div',
                              null,
                              h('span', null, '涉及任务'),
                              h('b', null, ((focusData && focusData.tasks) || []).length + ' 项'),
                            ),
                          ),
                          summaryMode === 'day'
                            ? h(
                                'div',
                                { className: 'lc-sum-focus-tasks' },
                                ((focusData && focusData.tasks) || []).slice(0, 3).map((item) =>
                                  h(
                                    'div',
                                    { key: item.taskId, className: 'lc-sum-focus-task' },
                                    h('span', { className: 'lc-sum-focus-task-title', title: item.title }, item.title),
                                    h(
                                      'span',
                                      { className: 'lc-sum-focus-task-meta' },
                                      '🍅 ' + item.tomatoes + ' · ' + formatDuration(item.seconds),
                                    ),
                                  ),
                                ),
                              )
                            : h(
                                'div',
                                { className: 'lc-sum-focus-chart' },
                                ((focusData && focusData.days) || []).map((day, index, list) => {
                                  const active = day.seconds > 0;
                                  const label =
                                    summaryMode === 'week'
                                      ? '日一二三四五六'[dateOf(day.date).getDay()]
                                      : index === 0 ||
                                          index === list.length - 1 ||
                                          (summaryMode === 'month' && dateOf(day.date).getDate() === 15)
                                        ? String(dateOf(day.date).getDate())
                                        : '';
                                  return h(
                                    'div',
                                    {
                                      key: day.date,
                                      className: 'lc-sum-focus-col' + (active ? ' is-active' : ''),
                                      title:
                                        monthDay(day.date) + ' · ' + day.tomatoes + ' 个番茄 · ' + formatDuration(day.seconds),
                                    },
                                    h(
                                      'div',
                                      { className: 'lc-sum-focus-bar' },
                                      active
                                        ? h('i', {
                                            style: {
                                              height: Math.max(6, Math.round((day.seconds / focusMax) * 100)) + '%',
                                            },
                                          })
                                        : null,
                                    ),
                                    h('span', { className: 'lc-sum-focus-day' }, label),
                                  );
                                }),
                              ),
                        ),
              ),
              h(
                'section',
                { className: 'lc-sum-card lc-sum-note' },
                h(
                  'div',
                  { className: 'lc-sum-note-head' },
                  h(
                    'div',
                    { className: 'lc-sum-note-title' },
                    h('span', { className: 'lc-sum-note-icon' }, h(GlyphIcon, { name: 'edit', size: 16 })),
                    h(
                      'div',
                      null,
                      h('h3', null, '我的感想'),
                      h('p', null, noteHint + ' · 只保存在本机'),
                    ),
                  ),
                  h('span', { className: 'lc-sum-note-state' + noteStateClass }, noteStateText),
                ),
                h('textarea', {
                  className: 'lc-sum-note-input',
                  value: note.content,
                  placeholder: note.loading
                    ? '正在读取…'
                    : '写几句给自己的复盘：哪件事推进得不错，哪里想换一种做法，下一步最想抓住什么…',
                  maxLength: 20000,
                  disabled: note.loading,
                  'aria-label': '我的感想',
                  onChange: changeSummaryNote,
                  onBlur: (event) => flushSummaryNote(event.target.value),
                  onKeyDown: (event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      flushSummaryNote(event.currentTarget.value);
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'lc-sum-note-foot' },
                  h(
                    'span',
                    { className: 'lc-sum-note-hint' + (note.error ? ' is-error' : '') },
                    note.error || '输入后自动保存 · 也可以按 ⌘/Ctrl + Enter',
                  ),
                  h(
                    'span',
                    { className: 'lc-sum-note-meta' },
                    note.error
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'lc-sum-note-retry',
                            onClick: () => persistSummaryNote(note.content, note.periodKey),
                          },
                          '重试',
                        )
                      : null,
                    note.content.length + ' 字',
                  ),
                ),
              ),
              h(
                'div',
                { className: 'lc-summary-grid' },
                h(
                  'section',
                  { className: 'lc-sum-card lc-sum-daily' },
                  h(
                    'div',
                    { className: 'lc-sum-card-head' },
                    h(
                      'div',
                      null,
                      h('h3', null, '每日完成情况'),
                      h(
                        'p',
                        null,
                        summaryMode === 'month'
                          ? '按截止日期 · 本月有任务的 ' + activeDays.length + ' 天'
                          : '按截止日期 · ' + period.days.length + ' 天逐日回顾',
                      ),
                    ),
                    h('span', { className: 'lc-sum-card-badge' }, doneT + ' 项完成'),
                  ),
                  listedDays.length
                    ? h(
                        'div',
                        { className: 'lc-sum-slots-axis', 'aria-hidden': 'true' },
                        ['00:00', '06:00', '12:00', '18:00', '24:00'].map((label) =>
                          h('span', { key: label }, label),
                        ),
                      )
                    : null,
                  listedDays.length
                    ? listedDays.map(renderDay)
                    : h('div', { className: 'lc-sum-empty' }, myTasks.loading ? '正在汇总任务…' : '这个周期还没有安排任务'),
                ),
                h(
                  'aside',
                  { className: 'lc-sum-card lc-sum-ai' },
                  h(
                    'div',
                    { className: 'lc-sum-ai-head' },
                    h(
                      'div',
                      { className: 'lc-sum-ai-title' },
                      h('span', { className: 'lc-sum-ai-icon' }, h(GlyphIcon, { name: 'sparkle', size: 18 })),
                      h(
                        'div',
                        null,
                        h('h3', null, 'AI 复盘'),
                        h('p', null, 'KISS 工作复盘 + 内容复盘 · 自动生成'),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'lc-sum-ai-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          onClick: () => setSummarySeed((value) => value + 1),
                          title: '换一种表达重新生成',
                        },
                        '重新生成',
                      ),
                      h('button', { type: 'button', onClick: copySummary, title: '复制总结文本' }, '复制'),
                    ),
                  ),
                  h('p', { className: 'lc-sum-opening' }, opening),
                  focusLine ? h('p', { className: 'lc-sum-focus-line' }, focusLine) : null,
                  total
                    ? h(
                        'div',
                        { className: 'lc-sum-content' },
                        h(
                          'div',
                          { className: 'lc-sum-content-head' },
                          h('span', null, '内容复盘'),
                          h('em', null, '主线：' + contentMain.join(' / ')),
                        ),
                        doneT
                          ? h('p', null, h('b', null, '已完成'), ' ' + contentLineOf(contentDoneGroups))
                          : null,
                        openT
                          ? h('p', null, h('b', null, '待推进'), ' ' + contentLineOf(contentOpenGroups))
                          : null,
                        droppedT
                          ? h(
                              'p',
                              { className: 'is-dropped' },
                              h('b', null, '已放下'),
                              ' ' + contentLineOf(contentDroppedGroups),
                            )
                          : null,
                      )
                    : null,
                  h(
                    'div',
                    { className: 'lc-sum-kiss' },
                    kiss.map((block) =>
                      h(
                        'div',
                        { key: block.key, className: 'lc-kiss lc-kiss-' + block.key },
                        h('span', { className: 'lc-kiss-badge' }, block.letter),
                        h(
                          'div',
                          { className: 'lc-kiss-body' },
                          h(
                            'div',
                            { className: 'lc-kiss-title' },
                            block.label,
                            h('span', null, block.en),
                          ),
                          h(
                            'ul',
                            { className: 'lc-kiss-list' },
                            block.items.map((line, index) => h('li', { key: index }, line)),
                          ),
                        ),
                      ),
                    ),
                  ),
                  h('p', { className: 'lc-sum-closing' }, closing),
                  h('p', { className: 'lc-sum-disclaimer' }, '基于本周期任务与番茄数据自动生成，仅供复盘参考。'),
                ),
              ),
            ),
          ),
        );
      };

      const renderPomodoroPage = () => {
        const today = todayKey();
        const stats = pomoStats.data || {
          date: pomoDay,
          totals: { sessions: 0, seconds: 0, tomatoes: 0 },
          tasks: [],
          sessions: [],
          days: [],
        };
        const selectedDate = new Date(pomoDay + 'T00:00:00');
        const weekday = Number.isNaN(selectedDate.getTime()) ? '' : '周' + '日一二三四五六'[selectedDate.getDay()];
        const dayLabel =
          Number.isNaN(selectedDate.getTime())
            ? pomoDay
            : selectedDate.getFullYear() + '年' + (selectedDate.getMonth() + 1) + '月' + selectedDate.getDate() + '日 ' + weekday;
        const shiftDay = (delta) => {
          const date = new Date(pomoDay + 'T00:00:00');
          if (Number.isNaN(date.getTime())) return;
          date.setDate(date.getDate() + delta);
          const next = dateKeyOf(date);
          if (next > today) return;
          setPomoDay(next);
        };
        const goToday = () => setPomoDay(today);
        const maxSeconds = Math.max(60, ...stats.days.map((day) => day.seconds || 0));
        const clockOf = (iso) => {
          const date = new Date(iso);
          return Number.isNaN(date.getTime()) ? '--:--' : pad2(date.getHours()) + ':' + pad2(date.getMinutes());
        };
        const empty = stats.sessions.length === 0;
        return h(
          'div',
          { className: 'lc-pomo-page' },
          h(
            'div',
            { className: 'lc-pomo-head' },
            h(
              'div',
              { className: 'lc-pomo-head-title' },
              h('h1', null, '番茄'),
              h('p', null, '每一段专注都算数。在任务上右键即可开始番茄钟。'),
            ),
            h(
              'div',
              { className: 'lc-pomo-head-controls' },
              h(
                'div',
                { className: 'lc-pomo-daynav' },
                h(
                  'button',
                  { type: 'button', className: 'lc-pomo-nav-btn', title: '前一天', 'aria-label': '前一天', onClick: () => shiftDay(-1) },
                  h(GlyphIcon, { name: 'chevron-left', size: 16 }),
                ),
                h('span', { className: 'lc-pomo-day-label' }, dayLabel),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-pomo-nav-btn',
                    title: '后一天',
                    'aria-label': '后一天',
                    disabled: pomoDay >= today,
                    onClick: () => shiftDay(1),
                  },
                  h(GlyphIcon, { name: 'chevron-right', size: 16 }),
                ),
              ),
              h(
                'button',
                { type: 'button', className: 'lc-pomo-today-btn', disabled: pomoDay === today, onClick: goToday },
                '回到今天',
              ),
              h(
                'button',
                { type: 'button', className: 'lc-pomo-nav-btn lc-pomo-refresh', title: '刷新', 'aria-label': '刷新番茄记录', onClick: () => loadPomodoroStats(pomoDay) },
                h(GlyphIcon, { name: 'refresh', size: 16 }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lc-pomo-body' },
            pomoStats.error
              ? h(
                  'div',
                  { className: 'lc-pomo-error' },
                  '读取番茄记录失败：' + pomoStats.error,
                  h('button', { type: 'button', onClick: () => loadPomodoroStats(pomoDay) }, '重试'),
                )
              : null,
            pomoStats.loading && !pomoStats.data
              ? h('div', { className: 'lc-pomo-loading' }, '正在读取番茄记录…')
              : h(
                  'div',
                  { className: 'lc-pomo-content' },
                  h(
                    'div',
                    { className: 'lc-pomo-metrics' },
                    h(
                      'div',
                      { className: 'lc-pomo-metric lc-pomo-metric-tomato' },
                      h('span', { className: 'lc-pomo-metric-label' }, '番茄'),
                      h('b', null, String(stats.totals.tomatoes)),
                      h('span', { className: 'lc-pomo-metric-sub' }, '完成倒计时'),
                    ),
                    h(
                      'div',
                      { className: 'lc-pomo-metric' },
                      h('span', { className: 'lc-pomo-metric-label' }, '专注时长'),
                      h('b', null, formatDuration(stats.totals.seconds)),
                      h('span', { className: 'lc-pomo-metric-sub' }, '全部计时合计'),
                    ),
                    h(
                      'div',
                      { className: 'lc-pomo-metric' },
                      h('span', { className: 'lc-pomo-metric-label' }, '专注次数'),
                      h('b', null, String(stats.totals.sessions)),
                      h('span', { className: 'lc-pomo-metric-sub' }, '含正计时'),
                    ),
                    h(
                      'div',
                      { className: 'lc-pomo-metric' },
                      h('span', { className: 'lc-pomo-metric-label' }, '涉及任务'),
                      h('b', null, String(stats.tasks.length)),
                      h('span', { className: 'lc-pomo-metric-sub' }, '有专注记录'),
                    ),
                  ),
                  h(
                    'section',
                    { className: 'lc-pomo-trend-card' },
                    h(
                      'div',
                      { className: 'lc-pomo-card-head' },
                      h('h2', null, '近 7 天'),
                      h('span', null, '点击柱形查看当天记录'),
                    ),
                    h(
                      'div',
                      { className: 'lc-pomo-trend' },
                      stats.days.map((item) => {
                        const date = new Date(item.date + 'T00:00:00');
                        const active = item.date === pomoDay;
                        const height = item.seconds > 0 ? Math.max(6, Math.round((item.seconds / maxSeconds) * 100)) : 2;
                        return h(
                          'button',
                          {
                            key: item.date,
                            type: 'button',
                            className:
                              'lc-pomo-trend-day' +
                              (active ? ' lc-pomo-trend-selected' : '') +
                              (active && item.seconds > 0 ? ' lc-pomo-trend-active' : ''),
                            title: item.date + ' · ' + formatDuration(item.seconds) + (item.tomatoes ? ' · 🍅' + item.tomatoes : ''),
                            onClick: () => setPomoDay(item.date),
                          },
                          h('span', { className: 'lc-pomo-trend-count' }, item.tomatoes ? '🍅' + item.tomatoes : ''),
                          h('span', { className: 'lc-pomo-trend-bar' }, h('i', { style: { height: height + '%' } })),
                          h(
                            'span',
                            { className: 'lc-pomo-trend-label' },
                            (date.getMonth() + 1) + '/' + date.getDate(),
                          ),
                        );
                      }),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'lc-pomo-columns' },
                    h(
                      'section',
                      { className: 'lc-pomo-card lc-pomo-session-card' },
                      h(
                        'div',
                        { className: 'lc-pomo-card-head' },
                        h('h2', null, '专注记录'),
                        h('span', null, stats.sessions.length + ' 次'),
                      ),
                      empty
                        ? h(
                            'div',
                            { className: 'lc-pomo-empty' },
                            h('span', { className: 'lc-pomo-empty-icon' }, '🍅'),
                            h('b', null, '这一天还没有专注记录'),
                            h('p', null, '在任务上右键，选择「开始番茄钟」，完成第一个番茄。'),
                          )
                        : h(
                            'div',
                            { className: 'lc-pomo-session-list' },
                            stats.sessions.map((session) =>
                              h(
                                'div',
                                {
                                  key: session.id,
                                  className: 'lc-pomo-session' + (session.completed ? ' lc-pomo-session-done' : ''),
                                },
                                h(
                                  'div',
                                  { className: 'lc-pomo-session-main' },
                                  h('b', null, session.taskTitle || '已删除任务'),
                                  h(
                                    'span',
                                    { className: 'lc-pomo-session-meta' },
                                    clockOf(session.startedAt) + '–' + clockOf(session.endedAt) + ' · ' + formatDuration(session.durationSeconds),
                                  ),
                                ),
                                session.completed
                                  ? h('span', { className: 'lc-pomo-badge' }, '🍅 1')
                                  : h(
                                      'span',
                                      { className: 'lc-pomo-badge lc-pomo-badge-muted' },
                                      session.mode === 'countup' ? '正计时' : '未完成',
                                    ),
                              ),
                            ),
                          ),
                    ),
                    h(
                      'section',
                      { className: 'lc-pomo-card lc-pomo-task-card' },
                      h(
                        'div',
                        { className: 'lc-pomo-card-head' },
                        h('h2', null, '任务专注'),
                        h('span', null, stats.tasks.length + ' 个任务'),
                      ),
                      stats.tasks.length
                        ? h(
                            'div',
                            { className: 'lc-pomo-task-list' },
                            stats.tasks.map((item) =>
                              h(
                                'button',
                                {
                                  key: item.taskId,
                                  type: 'button',
                                  className: 'lc-pomo-task',
                                  title: '打开任务详情',
                                  onClick: () => {
                                    setActiveView('tasks');
                                    setTaskFilter('inbox');
                                    loadDayTaskDetail(item.taskId);
                                  },
                                },
                                h('span', { className: 'lc-pomo-task-title' }, item.title),
                                h(
                                  'span',
                                  { className: 'lc-pomo-task-meta' },
                                  h('span', null, '🍅 ' + item.tomatoes),
                                  h('span', null, '·'),
                                  h('span', null, formatDuration(item.seconds)),
                                ),
                              ),
                            ),
                          )
                        : h('div', { className: 'lc-pomo-empty lc-pomo-empty-small' }, '还没有任务专注记录'),
                    ),
                  ),
                  h('p', { className: 'lc-pomo-tip' }, '番茄统计保存在本机数据库；倒计时完成才算 1 个番茄，正计时只累计时长。'),
                ),
          ),
        );
      };

      const renderUpdatePanel = () => {
        if (!updatePanel) return null;
        const data = updatePanel.data || {};
        const repo = data.repo || updatePanel.repoInput;
        const notes = String(data.notes || '').trim();
        const close = () => {
          if (updatePanel.applying) return;
          setUpdatePanel(null);
        };
        return h(
          'div',
          {
            className: 'lc-pomo-mask',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) close();
            },
          },
          h(
            'div',
            { className: 'lc-modal lc-update-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '检查更新' },
            h(
              'div',
              { className: 'lc-modal-head' },
              h('span', { className: 'lc-modal-title' }, '检查更新'),
              h(
                'button',
                { type: 'button', className: 'lc-modal-close', title: '关闭', 'aria-label': '关闭', onClick: close },
                h(GlyphIcon, { name: 'close', size: 15 }),
              ),
            ),
            h(
              'div',
              { className: 'lc-modal-body lc-update-body' },
              updatePanel.loading || updatePanel.applying
                ? h(
                    'div',
                    { className: 'lc-update-loading' },
                    h('span', { className: 'lc-spinner' }),
                    h('span', null,
                      updatePanel.applying
                        ? '正在下载并自动更新…'
                        : updatePanel.saving ? '正在保存更新源…' : '正在连接 GitHub…'),
                  )
                : h(
                    'div',
                    { className: 'lc-update-content' },
                    data.configured
                      ? h(
                          'div',
                          { className: 'lc-update-versions' },
                          h(
                            'div',
                            { className: 'lc-update-version' },
                            h('span', null, '当前版本'),
                            h('strong', null, 'v' + (data.current || APP_VERSION)),
                          ),
                          h('span', { className: 'lc-update-arrow' }, '→'),
                          h(
                            'div',
                            { className: 'lc-update-version lc-update-version-latest' },
                            h('span', null, '最新版本'),
                            h('strong', null, data.tag ? data.tag : '—'),
                          ),
                        )
                      : h(
                          'div',
                          { className: 'lc-update-intro' },
                          h('strong', null, '先设置更新源'),
                          h(
                            'p',
                            null,
                            '把插件上传到 GitHub 并打 Tag（例如 v0.2.0）后，把仓库地址填在这里。只保存在本机数据库，不会上传任何数据。',
                          ),
                        ),
                    updatePanel.result
                      ? h(
                          'div',
                          { className: 'lc-update-status is-latest' },
                          h(GlyphIcon, { name: 'check', size: 16 }),
                          h(
                            'span',
                            null,
                            updatePanel.restart && updatePanel.restart.started
                              ? '已自动更新到 v' + updatePanel.result.to + '，正在重启 DSH…'
                              : '已自动更新到 v' + updatePanel.result.to + '，重启 DSH 后生效。',
                          ),
                        )
                      : data.configured && !updatePanel.error
                        ? h(
                            'div',
                            { className: 'lc-update-status ' + (data.hasUpdate ? 'is-new' : 'is-latest') },
                            h(GlyphIcon, { name: data.hasUpdate ? 'download' : 'check', size: 16 }),
                            h(
                              'span',
                              null,
                              data.hasUpdate
                                ? '发现新版本 ' + data.tag + '，可自动更新，无需手动下载。'
                                : '已经是最新版本。',
                            ),
                          )
                        : null,
                    updatePanel.error
                      ? h('div', { className: 'lc-update-error' }, updatePanel.error)
                      : null,
                    data.configured && notes
                      ? h(
                          'div',
                          { className: 'lc-update-notes-wrap' },
                          h('div', { className: 'lc-update-notes-title' }, '更新说明'),
                          h('pre', { className: 'lc-update-notes' }, notes),
                        )
                      : null,
                    data.configured && !notes && !updatePanel.error && data.hasUpdate
                      ? h('p', { className: 'lc-update-hint' }, '这个版本没有填写更新说明，可以打开 GitHub 查看。')
                      : null,
                    data.configured
                      ? h(
                          'div',
                          { className: 'lc-update-source' },
                          h('span', null, '更新源 ' + repo),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'lc-update-linkbtn',
                              onClick: () => setUpdatePanel((prev) => (prev ? Object.assign({}, prev, { editingRepo: !prev.editingRepo }) : prev)),
                            },
                            updatePanel.editingRepo ? '收起' : '更换',
                          ),
                        )
                      : null,
                    updatePanel.editingRepo || !data.configured
                      ? h(
                          'div',
                          { className: 'lc-update-repo' },
                          h(
                            'label',
                            { className: 'lc-update-repo-label', htmlFor: 'lc-update-repo-input' },
                            'GitHub 仓库',
                          ),
                          h('input', {
                            id: 'lc-update-repo-input',
                            className: 'lc-input',
                            value: updatePanel.repoInput || '',
                            placeholder: 'owner/repo 或 https://github.com/owner/repo',
                            onChange: (event) =>
                              setUpdatePanel((prev) => (prev ? Object.assign({}, prev, { repoInput: event.target.value }) : prev)),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') saveUpdateRepo();
                            },
                          }),
                          h('p', { className: 'lc-update-hint' }, '支持 owner/repo、GitHub 链接；发布时打 v0.2.0 这样的 Tag。'),
                        )
                      : null,
                  ),
            ),
            h(
              'div',
              { className: 'lc-modal-foot lc-update-foot' },
              h(
                'button',
                { type: 'button', className: 'lc-btn lc-btn-ghost', onClick: close, disabled: updatePanel.applying },
                updatePanel.result ? '关闭' : '取消',
              ),
              data.configured && !updatePanel.result
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'lc-btn lc-btn-ghost',
                      onClick: () => fetchUpdate({ force: true }),
                      disabled: updatePanel.loading || updatePanel.applying,
                    },
                    '重新检查',
                  )
                : null,
              !data.configured
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'lc-btn lc-btn-primary',
                      onClick: saveUpdateRepo,
                      disabled: updatePanel.loading || updatePanel.saving,
                    },
                    '保存并检查',
                  )
                : updatePanel.editingRepo
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'lc-btn lc-btn-primary',
                        onClick: saveUpdateRepo,
                        disabled: updatePanel.loading || updatePanel.saving,
                      },
                      '保存并检查',
                    )
                  : updatePanel.result
                    ? null
                    : data.hasUpdate
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'lc-btn lc-btn-primary',
                            onClick: applyUpdateNow,
                            disabled: updatePanel.applying || updatePanel.loading,
                          },
                          updatePanel.applying ? '正在自动更新…' : '自动更新到 ' + data.tag,
                        )
                      : h(
                          'a',
                          {
                            className: 'lc-btn lc-btn-ghost',
                            href: data.htmlUrl || 'https://github.com/' + repo,
                            target: '_blank',
                            rel: 'noreferrer',
                          },
                          '查看 GitHub',
                        ),
            ),
          ),
        );
      };

      const moveTaskToQuadrant = async (task, targetKey) => {
        if (!task || !targetKey || matrixMoving) return;
        const target = Number(String(targetKey).replace(/^q/, ''));
        if (![1, 2, 3, 4].includes(target)) return;
        if (matrixQuadrantOf(task, todayKey()) === targetKey) return;
        const labels = { q1: '重要且紧急', q2: '重要不紧急', q3: '紧急不重要', q4: '不重要不紧急' };
        setMatrixMoving(String(task.id));
        setMyTasks((prev) =>
          Object.assign({}, prev, {
            tasks: (prev.tasks || []).map((item) =>
              String(item.id) === String(task.id) ? Object.assign({}, item, { quadrant: target }) : item,
            ),
          }),
        );
        try {
          await api('/calendar/api/task-quadrant', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: task.id, quadrant: target }),
          });
          if (dayTaskId && String(dayTaskId) === String(task.id)) {
            setDayDetail((prev) =>
              prev && prev.task
                ? Object.assign({}, prev, {
                    task: Object.assign({}, prev.task, { quadrant: target }),
                  })
                : prev,
            );
          }
          showNotice('已移到「' + labels[targetKey] + '」，优先级和截止日期保持不变', 'success');
        } catch (error) {
          showNotice('调整象限失败：' + error.message);
          await loadMyTasks();
        } finally {
          setMatrixMoving('');
        }
      };

      const boardStatusKey = (task) => {
        if (!task) return 'wait';
        if (task.done || task.status === 'done') return 'done';
        if (task.status === 'doing') return 'doing';
        return 'wait';
      };

      const boardAllTasks = () => (myTasks.tasks || []).filter((task) => !isDroppedStatus(task.status));

      const sortBoardTasks = (list) =>
        list.slice().sort((a, b) => {
          const pa = Number(a.priority) || 3;
          const pb = Number(b.priority) || 3;
          if (pa !== pb) return pa - pb;
          const da = String(a.deadline || '9999-99-99');
          const db = String(b.deadline || '9999-99-99');
          if (da !== db) return da < db ? -1 : 1;
          const sa = a.startTime === null || a.startTime === undefined ? 9999 : Number(a.startTime);
          const sb = b.startTime === null || b.startTime === undefined ? 9999 : Number(b.startTime);
          if (sa !== sb) return sa - sb;
          return Number(a.id) - Number(b.id);
        });

      const moveBoardTask = async (task, statusKey) => {
        if (!task || boardBusyId || isDroppedStatus(task.status)) return;
        if (boardStatusKey(task) === statusKey) return;
        const target = STATUS_OPTIONS.find((item) => item.value === statusKey);
        if (!target) return;
        const id = String(task.id);
        setBoardBusyId(id);
        setMyTasks((prev) =>
          Object.assign({}, prev, {
            tasks: (prev.tasks || []).map((item) =>
              String(item.id) === id
                ? Object.assign({}, item, {
                    status: statusKey,
                    statusText: target.label,
                    done: statusKey === 'done',
                  })
                : item,
            ),
          }),
        );
        try {
          const res = await postTaskStatus(task.id, statusKey);
          if (res && res.task) {
            setMyTasks((prev) =>
              Object.assign({}, prev, {
                tasks: (prev.tasks || []).map((item) => (String(item.id) === id ? res.task : item)),
              }),
            );
          }
          if (dayTaskId && String(dayTaskId) === id) refreshDayTaskDetail(task.id);
          showNotice('已移到「' + target.label + '」', 'success');
        } catch (error) {
          showNotice('移动任务失败：' + error.message);
          await loadMyTasks();
        } finally {
          setBoardBusyId('');
        }
      };

      const beginBoardDrag = (event, task) => {
        if (boardBusyId || isDroppedStatus(task.status)) {
          event.preventDefault();
          return;
        }
        const info = { id: String(task.id), from: boardStatusKey(task) };
        boardDragRef.current = info;
        setBoardDrag(info);
        setBoardOver(null);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(task.id));
        }
      };

      const overBoardColumn = (event, statusKey) => {
        const drag = boardDragRef.current;
        if (!drag || drag.from === statusKey) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        setBoardOver((prev) => (prev === statusKey ? prev : statusKey));
      };

      const leaveBoardColumn = (event, statusKey) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setBoardOver((prev) => (prev === statusKey ? null : prev));
      };

      const dropBoardColumn = (event, statusKey) => {
        event.preventDefault();
        const drag = boardDragRef.current;
        if (drag) boardDragEndRef.current = Date.now();
        boardDragRef.current = null;
        setBoardDrag(null);
        setBoardOver(null);
        if (!drag || drag.from === statusKey) return;
        const task = (myTasks.tasks || []).find((item) => String(item.id) === drag.id);
        if (task) moveBoardTask(task, statusKey);
      };

      const endBoardDrag = () => {
        if (boardDragRef.current) boardDragEndRef.current = Date.now();
        boardDragRef.current = null;
        setBoardDrag(null);
        setBoardOver(null);
      };

      const openBoardTask = (task) => {
        if (Date.now() - boardDragEndRef.current < 350) return;
        setMatrixDetailOpen(true);
        loadDayTaskDetail(task.id, task);
      };

      const boardDateText = (deadline) => {
        if (!deadline) return '未设置';
        const today = todayKey();
        if (deadline === today) return '今天';
        const tomorrowDate = new Date(today + 'T00:00:00');
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        if (deadline === dateKeyOf(tomorrowDate)) return '明天';
        const date = new Date(deadline + 'T00:00:00');
        if (Number.isNaN(date.getTime())) return deadline;
        if (date.getFullYear() !== new Date().getFullYear()) {
          return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
        }
        return date.getMonth() + 1 + '月' + date.getDate() + '日';
      };

      const renderBoardCard = (task) => {
        const today = todayKey();
        const statusKey = boardStatusKey(task);
        const doneCard = statusKey === 'done';
        const overdue = !doneCard && task.deadline && task.deadline < today;
        const busy = String(boardBusyId) === String(task.id);
        return h(
          'div',
          {
            key: task.id,
            className:
              'lc-board-card' +
              (doneCard ? ' is-done' : '') +
              (busy ? ' is-busy' : '') +
              (boardDrag && boardDrag.id === String(task.id) ? ' is-dragging' : ''),
            role: 'button',
            tabIndex: 0,
            draggable: !busy,
            'data-task-id': String(task.id),
            title: task.title,
            onClick: () => openBoardTask(task),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              openBoardTask(task);
            },
            onDragStart: (event) => beginBoardDrag(event, task),
            onDragEnd: endBoardDrag,
          },
          h(
            'div',
            { className: 'lc-board-card-top' },
            h('input', {
              type: 'checkbox',
              className: 'lc-task-check lc-board-check',
              checked: Boolean(task.done),
              disabled: busy || completingTasks.includes(task.id),
              title: task.done ? '取消完成，回到未开始' : '标记完成',
              'aria-label': (task.done ? '取消完成：' : '标记完成：') + task.title,
              onClick: (event) => event.stopPropagation(),
              onChange: () => completeTask(task),
            }),
            h('div', { className: 'lc-board-card-title' + (doneCard ? ' is-done' : '') }, task.title),
          ),
          h(
            'div',
            { className: 'lc-board-card-meta' },
            h('span', { className: 'lc-task-pri lc-task-pri-' + (task.priority || 3) }, 'P' + (task.priority || 3)),
            task.categoryId
              ? h(
                  'span',
                  { className: 'lc-board-cat', title: task.categoryName || '分类' },
                  h('span', {
                    className: 'lc-board-cat-dot',
                    style: { background: taskCategoryColor(task) },
                  }),
                  h('span', null, task.categoryName || '未分类'),
                )
              : null,
            h(
              'span',
              { className: 'lc-board-date' + (overdue ? ' is-overdue' : '') },
              boardDateText(task.deadline) +
                (task.startTime !== null && task.startTime !== undefined ? ' ' + clockText(task.startTime) : ''),
            ),
            h(TomatoMarks, { count: task.pomodoroCount, max: 3, className: 'lc-board-tomatoes' }),
          ),
        );
      };

      const renderBoardPage = () => {
        const grouped = { wait: [], doing: [], done: [] };
        for (const task of boardAllTasks()) grouped[boardStatusKey(task)].push(task);
        for (const key of Object.keys(grouped)) grouped[key] = sortBoardTasks(grouped[key]);
        const openCount = grouped.wait.length + grouped.doing.length;
        return h(
          'div',
          { className: 'lc-board' },
          h(
            'header',
            { className: 'lc-board-head' },
            h(
              'div',
              { className: 'lc-board-head-main' },
              h('div', { className: 'lc-board-title' }, '看板'),
              h(
                'div',
                { className: 'lc-board-sub' },
                '按状态分列 · 拖动卡片改变状态 · 已放弃任务不显示',
              ),
            ),
            h(
              'div',
              { className: 'lc-board-actions' },
              h('span', { className: 'lc-board-stat' }, h('b', null, String(openCount)), ' 未完成'),
              h('span', { className: 'lc-board-stat' }, h('b', null, String(grouped.doing.length)), ' 进行中'),
              h('span', { className: 'lc-board-stat' }, h('b', null, String(grouped.done.length)), ' 已完成'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'lc-icon-btn lc-board-refresh' + (myTasks.loading ? ' lc-spinning' : ''),
                  title: '刷新看板',
                  'aria-label': '刷新看板',
                  disabled: myTasks.loading,
                  onClick: () => loadMyTasks(true),
                },
                h(GlyphIcon, { name: 'refresh', size: 16 }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'lc-board-new',
                  onClick: () => openTaskModal(todayKey()),
                },
                h(GlyphIcon, { name: 'plus', size: 14 }),
                h('span', null, '新建任务'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'lc-board-body' },
            myTasks.error
              ? h(
                  'div',
                  { className: 'lc-board-error' },
                  h('span', null, '加载失败：' + myTasks.error),
                  h(
                    'button',
                    { type: 'button', className: 'lc-btn', onClick: () => loadMyTasks(true) },
                    '重试',
                  ),
                )
              : null,
            h(
              'div',
              { className: 'lc-board-cols' },
              BOARD_COLUMNS.map((column) =>
                h(
                  'section',
                  {
                    key: column.key,
                    className: 'lc-board-col' + (boardOver === column.key ? ' is-over' : ''),
                    'data-board-status': column.key,
                    style: { '--lc-board-accent': column.color },
                    onDragOver: (event) => overBoardColumn(event, column.key),
                    onDragLeave: (event) => leaveBoardColumn(event, column.key),
                    onDrop: (event) => dropBoardColumn(event, column.key),
                  },
                  h(
                    'div',
                    { className: 'lc-board-col-head' },
                    h('span', { className: 'lc-board-col-dot' }),
                    h('span', { className: 'lc-board-col-name' }, column.label),
                    h('span', { className: 'lc-board-col-count' }, String(grouped[column.key].length)),
                  ),
                  h(
                    'div',
                    { className: 'lc-board-list' },
                    grouped[column.key].length
                      ? grouped[column.key].map(renderBoardCard)
                      : h('div', { className: 'lc-board-empty' }, column.empty),
                  ),
                ),
              ),
            ),
          ),
        );
      };

      const renderMatrixPage = () => {
        const today = todayKey();
        const tomorrowDate = new Date(today + 'T00:00:00');
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = dateKeyOf(tomorrowDate);
        const currentYear = new Date().getFullYear();
        const openTasks = (myTasks.tasks || []).filter((task) => !task.done && !isDroppedStatus(task.status));
        const groups = { q1: [], q2: [], q3: [], q4: [] };
        for (const task of openTasks) {
          groups[matrixQuadrantOf(task, today)].push(task);
        }
        for (const key of Object.keys(groups)) {
          groups[key].sort((a, b) => {
            const byDate = String(a.deadline || '9999-12-31').localeCompare(String(b.deadline || '9999-12-31'));
            if (byDate) return byDate;
            return (Number(a.priority) || 3) - (Number(b.priority) || 3);
          });
        }
        const overdue = openTasks.filter((task) => task.deadline && task.deadline < today).length;
        const dueToday = openTasks.filter((task) => task.deadline === today).length;
        const dateText = (deadline) => {
          if (!deadline) return '未设置';
          if (deadline < today) {
            const date = new Date(deadline + 'T00:00:00');
            return '逾期 · ' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
          }
          if (deadline === today) return '今天';
          if (deadline === tomorrow) return '明天';
          const date = new Date(deadline + 'T00:00:00');
          const year = date.getFullYear() === currentYear ? '' : date.getFullYear() + '年';
          return year + (date.getMonth() + 1) + '月' + date.getDate() + '日';
        };
        const renderTask = (task) =>
          h(
            'div',
            {
              key: task.id,
              className:
                'lc-matrix-task' +
                (task.deadline && task.deadline < today ? ' is-overdue' : '') +
                (dayTaskId && String(dayTaskId) === String(task.id) ? ' is-selected' : '') +
                (matrixDragTask && String(matrixDragTask.id) === String(task.id) ? ' lc-matrix-task-dragging' : '') +
                (task.categoryId ? ' lc-matrix-task-cat' : ''),
              style: task.categoryId ? taskCategoryStyle(task) : undefined,
              title: task.title,
              draggable: !matrixMoving,
              onDragStart: (event) => {
                if (event.target.closest('input, button, a')) {
                  event.preventDefault();
                  return;
                }
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(task.id));
                }
                setMatrixDragTask(task);
              },
              onDragEnd: () => {
                setMatrixDragTask(null);
                setMatrixDropQuadrant(null);
              },
              onClick: () => {
                setMatrixDetailOpen(true);
                loadDayTaskDetail(task.id, task);
              },
            },
            isDroppedStatus(task.status)
              ? h(
                  'span',
                  {
                    className: 'lc-task-check lc-task-check-dropped',
                    title: '已放弃',
                    'aria-label': '已放弃：' + task.title,
                    onClick: (event) => event.stopPropagation(),
                  },
                  h(DroppedCross),
                )
              : h('input', {
                  type: 'checkbox',
                  className: 'lc-task-check',
                  checked: Boolean(task.done),
                  disabled: completingTasks.includes(task.id),
                  title: '标记完成',
                  'aria-label': '标记完成：' + task.title,
                  onClick: (event) => event.stopPropagation(),
                  onChange: () => completeTask(task),
                }),
            h(
              'div',
              { className: 'lc-matrix-task-main' },
              h('div', { className: 'lc-matrix-task-title' }, task.title),
              h(
                'div',
                { className: 'lc-matrix-task-meta' },
                task.quadrant ? h('span', { className: 'lc-matrix-manual', title: '手动指定象限；调整优先级或截止日期不会移动它' }, '手动') : null,
                h('span', { className: 'lc-task-pri lc-task-pri-' + (task.priority || 3) }, 'P' + (task.priority || 3)),
                h('span', { className: 'lc-matrix-task-date' }, dateText(task.deadline)),
                h(TomatoMarks, { count: task.pomodoroCount, max: 3 }),
              ),
            ),
          );
        const quadrants = [
          { key: 'q1', title: '重要且紧急', subtitle: '优先处理，别拖' },
          { key: 'q2', title: '重要不紧急', subtitle: '安排固定时间推进' },
          { key: 'q3', title: '紧急不重要', subtitle: '尽快处理或委托' },
          { key: 'q4', title: '不重要不紧急', subtitle: '有空再做' },
        ];
        return h(
          'div',
          { className: 'lc-matrix' },
          h(
            'header',
            { className: 'lc-matrix-head' },
            h(
              'div',
              { className: 'lc-matrix-head-title' },
              h('h2', null, '四象限'),
              h('p', null, '重要 × 紧急 · 初始按优先级/截止日期归类；拖动可单独调整，不改时间和优先级；双击空白处新建'),
            ),
            h(
              'div',
              { className: 'lc-matrix-head-stats' },
              h('span', null, '未完成 ', h('b', null, String(openTasks.length))),
              h('span', { className: overdue ? 'is-danger' : '' }, '逾期 ', h('b', null, String(overdue))),
              h('span', null, '今天 ', h('b', null, String(dueToday))),
            ),
          ),
          h(
            'div',
            { className: 'lc-matrix-body' + (dayTaskId ? ' is-detail' : '') },
            h(
              'div',
              { className: 'lc-matrix-grid' },
              quadrants.map((quadrant) => {
                const list = groups[quadrant.key];
                return h(
                  'section',
                  {
                    key: quadrant.key,
                    className:
                      'lc-matrix-card lc-matrix-' +
                      quadrant.key +
                      (matrixDropQuadrant === quadrant.key ? ' is-drop-target' : ''),
                    onDragOver: (event) => {
                      if (!matrixDragTask || matrixMoving) return;
                      event.preventDefault();
                      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                      if (matrixDropQuadrant !== quadrant.key) setMatrixDropQuadrant(quadrant.key);
                    },
                    onDragLeave: (event) => {
                      if (event.currentTarget.contains(event.relatedTarget)) return;
                      setMatrixDropQuadrant((prev) => (prev === quadrant.key ? null : prev));
                    },
                    onDrop: (event) => {
                      event.preventDefault();
                      const source = matrixDragTask;
                      setMatrixDragTask(null);
                      setMatrixDropQuadrant(null);
                      if (source) moveTaskToQuadrant(source, quadrant.key);
                    },
                    onDoubleClick: (event) => {
                      if (event.target && event.target.closest && event.target.closest('.lc-matrix-task')) return;
                      const index = Number(String(quadrant.key).replace('q', ''));
                      const important = index === 1 || index === 2;
                      const urgent = index === 1 || index === 3;
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      openTaskModal(urgent ? todayKey() : dateKeyOf(tomorrow), null, {
                        quadrant: index,
                        quadrantLabel: quadrant.title,
                        priority: important ? (urgent ? '1' : '2') : '3',
                        deadline: urgent ? todayKey() : dateKeyOf(tomorrow),
                      });
                    },
                  },
                  h(
                    'div',
                    { className: 'lc-matrix-card-head' },
                    h(
                      'div',
                      { className: 'lc-matrix-card-title' },
                      h('h3', null, quadrant.title),
                      h('p', null, quadrant.subtitle),
                    ),
                    h('span', { className: 'lc-matrix-count' }, String(list.length)),
                  ),
                  h(
                    'div',
                    { className: 'lc-matrix-list' },
                    list.length
                      ? list.map(renderTask)
                      : h(
                          'div',
                          { className: 'lc-matrix-empty' },
                          myTasks.loading
                            ? '加载中…'
                            : h(React.Fragment, null, h('span', null, '暂无任务'), h('small', null, '双击空白处新建')),
                        ),
                  ),
                );
              }),
            ),
          ),
        );
      };

      const renderSettingsPage = () => {
        const rangeOptions = [];
        for (let minute = 0; minute <= 24 * 60; minute += 30) rangeOptions.push(minute);
        const rangeHours = ((dayEndMin - dayStartMin) / 60).toFixed(1).replace(/\.0$/, '');
        const status = localEvents.loading
          ? '正在读取本机日历…'
          : localEvents.error
            ? '同步失败：' + localEvents.error
            : syncCalendar
              ? '已同步 ' + (localEvents.events.length || 0) + ' 个日程'
              : '未开启';
        const syncTime = localEvents.syncedAt
          ? new Date(localEvents.syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          : '';
        const obsidianLastSync = obsidian.lastSyncAt
          ? new Date(obsidian.lastSyncAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '';
        const obsidianErrorText = obsidianError || obsidian.lastError;
        const obsidianVault = (obsidian.vault || '').trim().replace(/\/+$/, '');
        const obsidianFile = obsidianVault ? obsidianVault + '/' + todayKey() + '.md' : '';
        const settingsSections = [
          { key: 'categories', label: '任务分类', icon: 'inbox' },
          { key: 'day-range', label: '日视图', icon: 'calendar' },
          { key: 'local-calendar', label: '本机日历', icon: 'refresh' },
          { key: 'obsidian', label: 'Obsidian', icon: 'book' },
          { key: 'data', label: '数据位置', icon: 'settings' },
        ];
        return h(
          'div',
          { className: 'lc-settings' },
          h(
            'div',
            { className: 'lc-settings-head' },
            h('h1', { className: 'lc-settings-title' }, '设置'),
            h('p', { className: 'lc-settings-sub' }, '分类、日视图、本机日历与 Obsidian'),
          ),
          h(
            'div',
            { className: 'lc-settings-body' },
            h(
              'aside',
              { className: 'lc-settings-nav', 'aria-label': '设置分区' },
              settingsSections.map((section) =>
                h(
                  'button',
                  {
                    key: section.key,
                    type: 'button',
                    className: 'lc-settings-nav-btn' + (settingsSection === section.key ? ' is-active' : ''),
                    'aria-current': settingsSection === section.key ? 'page' : undefined,
                    onClick: () => setSettingsSection(section.key),
                  },
                  h(GlyphIcon, { name: section.icon, size: 17 }),
                  h('span', null, section.label),
                ),
              ),
            ),
            h(
              'div',
              { className: 'lc-settings-detail', 'data-active-settings': settingsSection, ref: settingsDetailRef },
            h(
              'section',
              { className: 'lc-settings-card lc-cat-card', 'data-settings-section': 'categories' },
              h(
                'div',
                { className: 'lc-settings-card-head' },
                h(
                  'div',
                  null,
                  h('h2', { className: 'lc-settings-card-title' }, '任务分类'),
                  h('p', { className: 'lc-settings-card-sub' }, '任务卡片、日历和总结时间格使用分类颜色'),
                ),
                h('span', { className: 'lc-settings-cat-count' }, categories.length + ' 个分类'),
              ),
              categoriesError
                ? h(
                    'p',
                    { className: 'lc-settings-error' },
                    categoriesError,
                    h(
                      'button',
                      { type: 'button', className: 'lc-link-btn', onClick: () => void loadCategories() },
                      '重试',
                    ),
                  )
                : null,
              h(
                'div',
                { className: 'lc-cat-list' },
                categories.length
                  ? categories.map((category) =>
                      h(
                        'div',
                        {
                          key: category.id,
                          className:
                            'lc-cat-row' + (categoryBusy === String(category.id) ? ' is-busy' : ''),
                        },
                        h('input', {
                          type: 'color',
                          className: 'lc-cat-color',
                          value: category.color,
                          disabled: categoryBusy === String(category.id),
                          'aria-label': category.name + '的颜色',
                          onChange: (event) => patchCategoryLocal(category.id, { color: event.target.value }),
                          onBlur: () => void saveCategory(category),
                        }),
                        h('input', {
                          type: 'text',
                          className: 'lc-input lc-cat-name',
                          value: category.name,
                          maxLength: 24,
                          disabled: categoryBusy === String(category.id),
                          'aria-label': '分类名称',
                          onChange: (event) => patchCategoryLocal(category.id, { name: event.target.value }),
                          onBlur: () => void saveCategory(category),
                          onKeyDown: (event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          },
                        }),
                        h('span', { className: 'lc-cat-count' }, (Number(category.taskCount) || 0) + ' 个任务'),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'lc-icon-btn lc-cat-delete',
                            title: '删除分类',
                            'aria-label': '删除分类 ' + category.name,
                            disabled: categoryBusy === String(category.id),
                            onClick: () => void deleteCategory(category),
                          },
                          h(GlyphIcon, { name: 'trash', size: 15 }),
                        ),
                      ),
                    )
                  : h('p', { className: 'lc-settings-note' }, categoriesLoading ? '正在读取分类…' : '还没有分类'),
              ),
              h(
                'div',
                { className: 'lc-cat-add' },
                h('input', {
                  type: 'color',
                  className: 'lc-cat-color',
                  value: categoryDraft.color,
                  'aria-label': '新分类颜色',
                  onChange: (event) => setCategoryDraft((prev) => Object.assign({}, prev, { color: event.target.value })),
                }),
                h('input', {
                  type: 'text',
                  className: 'lc-input lc-cat-name',
                  value: categoryDraft.name,
                  maxLength: 24,
                  placeholder: '新分类名称',
                  'aria-label': '新分类名称',
                  onChange: (event) => setCategoryDraft((prev) => Object.assign({}, prev, { name: event.target.value })),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void createCategory();
                    }
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-btn lc-btn-sm',
                    disabled: categoryBusy === 'create' || !String(categoryDraft.name || '').trim(),
                    onClick: () => void createCategory(),
                  },
                  '添加分类',
                ),
              ),
              h(
                'p',
                { className: 'lc-settings-note' },
                '默认分类为工作、生活、学习、健康、娱乐、放松；删除分类不会删除任务，任务会回到未分类。',
              ),
            ),
            h(
              'section',
              { className: 'lc-settings-card' },
              h(
                'div',
                { className: 'lc-settings-card-head' },
                h(
                  'div',
                  null,
                  h('h2', { className: 'lc-settings-card-title' }, '日视图时间范围'),
                  h('p', { className: 'lc-settings-card-sub' }, '控制日视图显示的时间段，任务拖拽和新建也会限制在范围内'),
                ),
              ),
              h(
                'div',
                { className: 'lc-settings-range' },
                h(
                  'label',
                  { className: 'lc-settings-range-field' },
                  h('span', { className: 'lc-settings-range-label' }, '开始'),
                  h(
                    'select',
                    {
                      className: 'lc-settings-select',
                      value: String(dayStartMin),
                      'aria-label': '日视图开始时间',
                      onChange: (event) => void changeDayRange(Number(event.target.value), dayEndMin),
                    },
                    rangeOptions
                      .filter((minute) => minute <= dayEndMin - 60)
                      .map((minute) => h('option', { key: 'start-' + minute, value: minute }, clockText(minute))),
                  ),
                ),
                h('span', { className: 'lc-settings-range-sep' }, '至'),
                h(
                  'label',
                  { className: 'lc-settings-range-field' },
                  h('span', { className: 'lc-settings-range-label' }, '结束'),
                  h(
                    'select',
                    {
                      className: 'lc-settings-select',
                      value: String(dayEndMin),
                      'aria-label': '日视图结束时间',
                      onChange: (event) => void changeDayRange(dayStartMin, Number(event.target.value)),
                    },
                    rangeOptions
                      .filter((minute) => minute >= dayStartMin + 60)
                      .map((minute) => h('option', { key: 'end-' + minute, value: minute }, clockText(minute))),
                  ),
                ),
                h('span', { className: 'lc-settings-range-summary' }, '共 ' + rangeHours + ' 小时'),
              ),
              h(
                'p',
                { className: 'lc-settings-note' },
                '当前显示 ' + clockText(dayStartMin) + '–' + clockText(dayEndMin) + '。设置保存在本机数据库，只影响日视图的显示范围。',
              ),
            ),
            h(
              'section',
              { className: 'lc-settings-card' },
              h(
                'div',
                { className: 'lc-settings-card-head' },
                h(
                  'div',
                  null,
                  h('h2', { className: 'lc-settings-card-title' }, '本机日历同步'),
                  h('p', { className: 'lc-settings-card-sub' }, '读取 macOS 日历中带具体时间的日程，只读展示'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'switch',
                    className: 'lc-switch' + (syncCalendar ? ' lc-switch-on' : ''),
                    'aria-checked': syncCalendar ? 'true' : 'false',
                    'aria-label': '同步本机日历',
                    onClick: () => void toggleLocalCalendar(),
                  },
                  h('span', { className: 'lc-switch-handle' }),
                ),
              ),
              h(
                'div',
                { className: 'lc-settings-sync-row' },
                h('span', { className: 'lc-settings-status' + (localEvents.error ? ' is-error' : '') }, status),
                syncTime ? h('span', { className: 'lc-settings-time' }, '上次读取 ' + syncTime) : null,
                syncCalendar
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'lc-btn lc-btn-ghost lc-settings-sync-btn',
                        disabled: localEvents.loading,
                        onClick: () => void loadLocalEvents(true, true),
                      },
                      '重新同步',
                    )
                  : null,
              ),
              localEvents.error
                ? h(
                    'p',
                    { className: 'lc-settings-error' },
                    localEvents.error + '。如未授权，请在「系统设置 → 隐私与安全性 → 日历」中允许 DeepSeek Harness 访问日历。',
                  )
                : null,
              localEvents.calendars.length
                ? h(
                    'div',
                    { className: 'lc-settings-calendars' },
                    localEvents.calendars.slice(0, 8).map((name) =>
                      h('span', { key: name, className: 'lc-settings-calendar' }, name),
                    ),
                  )
                : null,
              h(
                'p',
                { className: 'lc-settings-note' },
                '读取范围跟随当前日历视图；全天日程暂不导入。只读，不会修改系统日历。首次开启时 macOS 会请求日历权限。',
              ),
            ),
            h(
              'section',
              { className: 'lc-settings-card' },
              h('h2', { className: 'lc-settings-card-title' }, '数据位置'),
              h(
                'p',
                { className: 'lc-settings-note' },
                '任务、番茄和感想保存在本机 SQLite：$DSH_HOME/calendar/db/calendar.sqlite（默认 ~/.dsh/calendar/db/calendar.sqlite）。换浏览器或清缓存不会丢失。',
              ),
              h('p', { className: 'lc-settings-note' }, '日视图范围与本机日历开关也写在本机数据库；窗口列宽等临时偏好仍保存在浏览器。'),
              h(
                'p',
                { className: 'lc-settings-note' },
                '农历日期、二十四节气与传统节日按香港天文台《公历与农历对照表》标注；2025–2027 已逐日核对。节日优先于节气，小年分北方腊月二十三、南方腊月二十四。',
              ),
            ),
            h(
              'section',
              { className: 'lc-settings-card' },
              h(
                'div',
                { className: 'lc-settings-card-head' },
                h('h2', { className: 'lc-settings-card-title' }, 'Obsidian 日志'),
                h('span', { className: 'lc-settings-badge' }, '本地'),
              ),
              h(
                'p',
                { className: 'lc-settings-note' },
                '把今天的任务和总结写进 Obsidian 当天的日记。只更新指定的标题段落，其他内容不动。',
              ),
              h(
                'div',
                { className: 'lc-obsidian-enable' },
                h(
                  'div',
                  null,
                  h('strong', null, '自动写入'),
                  h('span', null, '保存后按设定的间隔写入当天日志'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lc-switch' + (obsidian.enabled ? ' lc-switch-on' : ''),
                    role: 'switch',
                    'aria-checked': Boolean(obsidian.enabled),
                    'aria-label': '开启 Obsidian 自动写入',
                    onClick: () => updateObsidian({ enabled: !obsidian.enabled }),
                  },
                  h('span', { className: 'lc-switch-handle' }),
                ),
              ),
              h(
                'div',
                { className: 'lc-obsidian-form' },
                h(
                  'label',
                  { className: 'lc-obsidian-field' },
                  h('span', { className: 'lc-obsidian-label' }, 'Obsidian 仓库目录'),
                  h('input', {
                    type: 'text',
                    className: 'lc-obsidian-input',
                    value: obsidian.vault,
                    placeholder: '例如 /Users/你/Documents/ObsidianVault',
                    spellCheck: false,
                    onChange: (event) => updateObsidian({ vault: event.target.value }),
                  }),
                  h(
                    'span',
                    { className: 'lc-obsidian-path' },
                    obsidianFile ? '将写入：' + obsidianFile : '填写仓库目录后显示目标文件路径',
                  ),
                ),
                h(
                  'div',
                  { className: 'lc-obsidian-grid' },
                  h(
                    'label',
                    { className: 'lc-obsidian-field' },
                    h('span', { className: 'lc-obsidian-label' }, '写入到哪个标题'),
                    h('input', {
                      type: 'text',
                      className: 'lc-obsidian-input',
                      value: obsidian.heading,
                      placeholder: '## todo',
                      spellCheck: false,
                      onChange: (event) => updateObsidian({ heading: event.target.value }),
                    }),
                  ),
                  h(
                    'label',
                    { className: 'lc-obsidian-field lc-obsidian-interval' },
                    h('span', { className: 'lc-obsidian-label' }, '自动写入间隔'),
                    h(
                      'span',
                      { className: 'lc-obsidian-interval-wrap' },
                      h('input', {
                        type: 'number',
                        className: 'lc-obsidian-input',
                        min: 1,
                        max: 1440,
                        step: 1,
                        value: obsidian.intervalMinutes,
                        onChange: (event) =>
                          updateObsidian({ intervalMinutes: event.target.value === '' ? '' : Number(event.target.value) }),
                      }),
                      h('span', null, '分钟'),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'lc-obsidian-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lc-btn lc-btn-primary',
                      disabled: Boolean(obsidianBusy),
                      onClick: () => void saveObsidian(true),
                    },
                    obsidianBusy === 'save' ? '保存中…' : '保存并立即写入',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lc-btn lc-btn-ghost',
                      disabled: Boolean(obsidianBusy),
                      onClick: () => void saveObsidian(false),
                    },
                    '仅保存',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lc-btn lc-btn-ghost',
                      disabled: Boolean(obsidianBusy),
                      onClick: () => void syncObsidianNow(),
                    },
                    obsidianBusy === 'sync' ? '写入中…' : '立即写入',
                  ),
                ),
                h(
                  'div',
                  { className: 'lc-obsidian-status' + (obsidianErrorText ? ' is-error' : obsidian.lastSyncAt ? ' is-ok' : '') },
                  h('strong', null, obsidianErrorText ? '写入失败' : obsidian.lastSyncAt ? '上次写入成功' : '尚未写入'),
                  h(
                    'span',
                    null,
                    obsidianErrorText ||
                      (obsidian.lastSyncAt
                        ? obsidianLastSync + (obsidian.lastResult ? ' · ' + obsidian.lastResult : '')
                        : '保存配置后会自动创建当天的 Markdown 文件。'),
                  ),
                ),
                h(
                  'div',
                  { className: 'lc-obsidian-rules' },
                  h('h3', null, '写入规则'),
                  h(
                    'ul',
                    null,
                    h('li', null, '文件固定为「仓库目录/YYYY-MM-DD.md」，不存在时自动创建；不会改动仓库里的其他笔记。'),
                    h(
                      'li',
                      null,
                      '只替换标题 ',
                      h('code', null, obsidian.heading || '## todo'),
                      ' 到下一个同级或更高级标题之间的内容；标题外的原文保留。',
                    ),
                    h('li', null, '当天任务按截止日期筛选：未完成在前、已完成在后；有开始时间的写成 HH:MM；已放弃任务不写入。'),
                    h('li', null, '同时写入「## 今日总结」：专注时长、番茄数、任务完成率、AI 复盘（本地规则）和当天感想；该节不存在时追加到文末。'),
                    h('li', null, '每次写入整节覆盖，不会重复累加；当天没有任务时任务节写入「- 今日暂无任务」。'),
                    h('li', null, '任务写入标题不能使用「今日总结」，以免和总结节冲突。'),
                    h('li', null, '开启自动写入后按间隔执行（需保持 DSH 运行）；「立即写入」不受开关影响，关闭开关会停止自动写入。'),
                    h('li', null, '目录必须是本机绝对路径；只读写填写的目录，不联网、不上传。'),
                  ),
                ),
              ),
            ),
            ),
          ),
        );
      };

      const renderNav = () =>
        h(
          'nav',
          { className: 'lc-nav', 'aria-label': '插件菜单' },
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn' + (activeView === 'tasks' ? ' lc-nav-btn-active' : ''),
              title: '任务列表',
              'aria-label': '任务列表',
              onClick: () => setActiveView('tasks'),
            },
            h(GlyphIcon, { name: 'list', size: 20 }),
            h('span', null, '任务'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn' + (activeView === 'calendar' ? ' lc-nav-btn-active' : ''),
              title: '任务日历',
              'aria-label': '任务日历',
              onClick: () => setActiveView('calendar'),
            },
            h(GlyphIcon, { name: 'calendar', size: 20 }),
            h('span', null, '日历'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn' + (activeView === 'board' ? ' lc-nav-btn-active' : ''),
              title: '任务看板',
              'aria-label': '任务看板',
              onClick: () => setActiveView('board'),
            },
            h(GlyphIcon, { name: 'board', size: 20 }),
            h('span', null, '看板'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn' + (activeView === 'matrix' ? ' lc-nav-btn-active' : ''),
              title: '四象限',
              'aria-label': '四象限',
              onClick: () => setActiveView('matrix'),
            },
            h(GlyphIcon, { name: 'grid', size: 20 }),
            h('span', null, '四象限'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn' + (activeView === 'summary' ? ' lc-nav-btn-active' : ''),
              title: '工作总结',
              'aria-label': '工作总结',
              onClick: () => setActiveView('summary'),
            },
            h(GlyphIcon, { name: 'chart', size: 20 }),
            h('span', null, '总结'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn' + (activeView === 'pomodoro' ? ' lc-nav-btn-active' : ''),
              title: '番茄统计',
              'aria-label': '番茄统计',
              onClick: () => setActiveView('pomodoro'),
            },
            h(GlyphIcon, { name: 'timer', size: 20 }),
            h('span', null, '番茄'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn lc-nav-settings' + (activeView === 'settings' ? ' lc-nav-btn-active' : ''),
              title: '设置',
              'aria-label': '设置',
              onClick: () => setActiveView('settings'),
            },
            h(GlyphIcon, { name: 'settings', size: 19 }),
            h('span', null, '设置'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lc-nav-btn lc-nav-update',
              title: '检查更新',
              'aria-label': '检查更新',
              onClick: openUpdatePanel,
            },
            h(GlyphIcon, { name: 'refresh', size: 18 }),
            h('span', null, '检查更新'),
          ),
          h('span', { className: 'lc-nav-version', title: '任务日历 v' + APP_VERSION }, 'v' + APP_VERSION),
        );

      const renderMatrixDetailModal = () =>
        h(
          'div',
          {
            className: 'lc-detail-mask',
            onMouseDown: (event) => {
              if (event.target !== event.currentTarget) return;
              setMatrixDetailOpen(false);
              setDayTaskId(null);
              setDayDetail(null);
            },
          },
          h(
            'div',
            { className: 'lc-modal lc-detail-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '任务详情' },
            renderDayDetail(null),
          ),
        );

      return h(
        'div',
        { className: 'lc-root', ref: rootRef, style: skinStyle('blue') },
        h('style', null, CSS),
        renderNav(),
        h(
          'div',
          { className: 'lc-stage' },
          activeView === 'calendar'
            ? h('div', { className: 'lc-page' }, h('div', { className: 'lc-page-inner' }, renderCalendar()))
            : activeView === 'tasks'
              ? renderTasksPage()
              : activeView === 'board'
                ? renderBoardPage()
                : activeView === 'matrix'
                  ? renderMatrixPage()
                : activeView === 'summary'
                ? renderSummaryPage()
                : activeView === 'settings'
                  ? renderSettingsPage()
                  : renderPomodoroPage(),
        ),
        matrixDetailOpen && dayTaskId ? renderMatrixDetailModal() : null,
        taskModal ? renderTaskModal() : null,
        pomoSetup ? renderPomodoroSetup() : null,
        updatePanel ? renderUpdatePanel() : null,
        renderPomodoroFloat(),
        renderPomodoroCelebration(),
        renderCalendarStatusPopup(),
        actionNotice ? h('div', { className: 'lc-toast lc-toast-' + actionNotice.kind }, actionNotice.text) : null,
      );
    }

    // ── 样式（类名统一 lc- 前缀）────────────────────────────────────────────
    const CSS = `.lc-root{
--lc-brand:#2f7cf6;--lc-brand-deep:#245fd6;--lc-brand-light:#6f9dff;--lc-brand-soft:#eaf1ff;--lc-brand-rgb:47,124,246;
--td-brand-color:#0052d9;--td-brand-color-hover:#366ef4;--td-brand-color-focus:#d9e1ff;--td-brand-color-active:#003cab;--td-brand-color-disabled:#b5c7ff;--td-brand-color-light:#f2f3ff;--td-brand-color-light-hover:#d9e1ff;
--td-success-color:#2ba471;--td-success-color-hover:#56c08d;--td-success-color-focus:#c6f3d7;--td-success-color-disabled:#92dab2;--td-success-color-light:#e3f9e9;
--td-warning-color:#e37318;--td-warning-color-hover:#fa9550;--td-warning-color-focus:#ffd9c2;--td-warning-color-disabled:#ffb98c;--td-warning-color-light:#fff1e9;
--td-error-color:#d54941;--td-error-color-hover:#f6685d;--td-error-color-focus:#ffd8d2;--td-error-color-disabled:#ffb9b0;--td-error-color-light:#fff0ed;
--td-text-color-primary:rgba(0,0,0,.9);--td-text-color-secondary:rgba(0,0,0,.6);--td-text-color-placeholder:rgba(0,0,0,.4);--td-text-color-disabled:rgba(0,0,0,.26);--td-text-color-anti:#fff;--td-text-color-brand:#0052d9;
--td-bg-color-page:#eee;--td-bg-color-container:#fff;--td-bg-color-container-hover:#f3f3f3;--td-bg-color-container-active:#e8e8e8;
--td-bg-color-secondarycontainer:#f3f3f3;--td-bg-color-secondarycontainer-hover:#eee;
--td-bg-color-component:#e8e8e8;--td-bg-color-component-hover:#ddd;--td-bg-color-component-disabled:#eee;--td-bg-color-specialcomponent:#fff;
--td-border-level-1-color:#e8e8e8;--td-border-level-2-color:#ddd;--td-component-stroke:#e8e8e8;--td-component-border:#ddd;
--td-radius-small:2px;--td-radius-default:3px;--td-radius-medium:6px;--td-radius-large:9px;--td-radius-extraLarge:12px;
--td-shadow-1:0 1px 10px rgba(0,0,0,.05),0 4px 5px rgba(0,0,0,.08),0 2px 4px -1px rgba(0,0,0,.12);
--td-shadow-2:0 3px 14px 2px rgba(0,0,0,.05),0 8px 10px 1px rgba(0,0,0,.06),0 5px 5px -3px rgba(0,0,0,.1);
--td-font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;--td-font-family-code:ui-monospace,SFMono-Regular,Menlo,monospace;
--td-font-body-small:12px/20px var(--td-font-family);--td-font-body-medium:14px/22px var(--td-font-family);--td-font-title-small:600 14px/22px var(--td-font-family);--td-font-title-medium:600 16px/24px var(--td-font-family);--td-font-mark-small:600 12px/20px var(--td-font-family);
--td-comp-size-xs:24px;--td-comp-size-s:28px;--td-comp-size-m:32px;--td-comp-size-l:36px;--td-comp-size-xxl:48px;
--td-comp-paddingLR-s:8px;--td-comp-paddingLR-m:12px;--td-comp-paddingLR-l:16px;--td-comp-paddingTB-s:8px;--td-comp-paddingTB-m:12px;--td-comp-paddingTB-l:16px;
--td-comp-margin-xs:4px;--td-comp-margin-s:8px;--td-comp-margin-m:12px;--td-comp-margin-l:16px;--td-comp-margin-xl:20px;
--td-gray-color-1:#f3f3f3;--td-gray-color-2:#eee;--td-gray-color-3:#e8e8e8;--td-gray-color-8:#777;
--td-scrollbar-color:rgba(0,0,0,.1);--td-scrollbar-hover-color:rgba(0,0,0,.3);
}

body[data-ds-dark-theme] .lc-root .lc-main,body[data-ds-dark-theme] .lc-root .lc-table-wrap,body[data-ds-dark-theme] .lc-root .lc-table th{background:#242424}
body[data-ds-dark-theme] .lc-root{--lc-card-bg:#1e2a3b;--lc-card-border:#33445c;--lc-card-primary-bg:#253549;
--td-brand-color:#4582e6;--td-brand-color-hover:#2667d4;--td-brand-color-focus:#173463;--td-brand-color-active:#699ef5;--td-brand-color-disabled:#143975;--td-brand-color-light:#1b2f51;--td-brand-color-light-hover:#173463;
--td-success-color:#059465;--td-success-color-hover:#0d7a55;--td-success-color-focus:#1a4230;--td-success-color-disabled:#17533d;--td-success-color-light:#193a2a;
--td-warning-color:#cf6e2d;--td-warning-color-hover:#a75d2b;--td-warning-color-focus:#582f21;--td-warning-color-disabled:#733c23;--td-warning-color-light:#4f2a1d;
--td-error-color:#c64751;--td-error-color-hover:#a03f46;--td-error-color-focus:#5e2a2d;--td-error-color-disabled:#703439;--td-error-color-light:#472324;
--td-text-color-primary:rgba(255,255,255,.9);--td-text-color-secondary:rgba(255,255,255,.55);--td-text-color-placeholder:rgba(255,255,255,.35);--td-text-color-disabled:rgba(255,255,255,.22);--td-text-color-anti:#fff;--td-text-color-brand:#4582e6;
--td-bg-color-page:#181818;--td-bg-color-container:#242424;--td-bg-color-container-hover:#2c2c2c;--td-bg-color-container-active:#5e5e5e;
--td-bg-color-secondarycontainer:#2c2c2c;--td-bg-color-secondarycontainer-hover:#393939;
--td-bg-color-component:#393939;--td-bg-color-component-hover:#4b4b4b;--td-bg-color-component-disabled:#2c2c2c;--td-bg-color-specialcomponent:transparent;
--td-border-level-1-color:#393939;--td-border-level-2-color:#5e5e5e;--td-component-stroke:#393939;--td-component-border:#5e5e5e;
--td-gray-color-1:#f3f3f3;--td-gray-color-2:#eee;--td-gray-color-3:#e8e8e8;--td-gray-color-8:#777;
--td-scrollbar-color:hsla(0,0%,100%,.1);--td-scrollbar-hover-color:hsla(0,0%,100%,.3);
}

.lc-root{position:relative;display:flex;flex-wrap:nowrap;flex:1 1 auto;align-self:stretch;width:100%;max-width:100%;height:100%;min-height:0;min-width:0;border-radius:12px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);overflow:hidden;--lc-radius:5px;--lc-icon:var(--dsw-alias-menu-icon,var(--dsw-alias-label-secondary,#666));--lc-icon-muted:var(--dsw-alias-label-tertiary,#999);--lc-icon-strong:var(--dsw-alias-label-primary,#1a1a1a);--lc-icon-brand:var(--dsw-alias-link,var(--dsw-static-deepseek-500,#4176e6));--lc-card-bg:#eff5ff;--lc-card-border:#dbe7fb;--lc-card-primary-bg:#e2edfe;--lc-card-primary-border:var(--td-brand-color)}
.lc-boot{align-items:center;justify-content:center}
.lc-boot-hint{font:var(--td-font-body-small);color:var(--td-text-color-placeholder)}
.lc-root *,.lc-root *:before,.lc-root *:after{box-sizing:border-box}
.lc-pane{display:flex;flex:0 0 auto;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--td-bg-color-container)}
.lc-left{position:relative;background:var(--dsw-specific-sidebar-fill,var(--td-bg-color-secondarycontainer))}
.lc-main{position:relative;flex:1 1 0;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--td-bg-color-container);container-type:inline-size}
.lc-main-dragstrip{position:absolute;left:0;right:0;top:0;height:14px;z-index:6;-webkit-app-region:drag}
.lc-split{flex:0 0 8px;width:8px;cursor:col-resize;background:transparent;position:relative;z-index:2}
.lc-split:after{content:'';position:absolute;left:50%;top:0;bottom:0;width:1px;margin-left:-0.5px;background:var(--td-component-stroke)}
.lc-split:hover:after,.lc-split:active:after{background:var(--td-brand-color);width:2px;margin-left:-1px}
.lc-rail{flex:0 0 40px;width:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 4px;background:var(--td-bg-color-container);user-select:none}
.lc-rail-left{border-right:1px solid var(--td-component-stroke)}
.lc-rail-right{border-left:1px solid var(--td-component-stroke)}
/* macOS overlay title bar: keep the collapsed rail clear of the traffic lights. */
.lc-mac .lc-rail{padding-top:0}
.lc-under-lights .lc-left .lc-pane-head{padding-left:var(--lc-pane-head-pad,16px)}
.lc-under-lights.lc-left-closed .lc-main-head{padding-left:var(--lc-main-head-pad,16px)}
:is(html,body):has([data-sidebar-collapsed]) .lc-root.lc-left-closed .lc-main-head .lc-tabs,:is(html,body):has([data-sidebar-collapsed]) .lc-root.lc-left-closed .lc-team-head .lc-tabs{margin-left:100px}
.lc-pane-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 8px 0 16px;border-bottom:1px solid var(--td-component-stroke);height:48px;min-height:48px;min-width:0;-webkit-app-region:drag}
.lc-pane-title{font:var(--td-font-title-small);color:var(--td-text-color-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;transition:max-width .22s cubic-bezier(.4,0,.2,1),opacity .12s linear}
.lc-head-actions{display:flex;align-items:center;gap:4px;margin-left:auto;-webkit-app-region:no-drag}
.lc-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:0 0 auto;border:0;background:transparent;color:var(--lc-icon);cursor:pointer;padding:0;border-radius:var(--lc-radius);transition:background-color .2s linear,color .2s linear}
.lc-icon-btn:hover:not(:disabled){background:var(--td-bg-color-container-hover);color:var(--td-text-color-primary)}
.lc-icon-btn:active:not(:disabled){background:var(--td-bg-color-container-active)}
.lc-icon-btn:focus-visible{outline:2px solid var(--td-brand-color-focus);outline-offset:0}
.lc-icon-btn:disabled{color:var(--td-text-color-disabled);cursor:not-allowed}
.lc-icon-btn.lc-spinning svg{animation:lc-spin .9s linear infinite}
@keyframes lc-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.lc-icon-btn.lc-spinning svg{animation:none}}
.lc-tree-filter-row{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--td-component-stroke);flex:0 0 auto}
.lc-tree-filter-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--td-font-body-small);color:var(--td-text-color-secondary)}
.lc-tree-filter-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.lc-tree-search{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;-webkit-app-region:no-drag}
.lc-tree-search-icon{display:flex;flex:0 0 auto;color:var(--lc-icon)}
.lc-tree-search-input{flex:1 1 auto;min-width:0;height:24px;border:0;background:transparent;color:var(--td-text-color-primary);font:var(--td-font-body-medium);outline:none;padding:0}
.lc-tree-search-input::placeholder{color:var(--td-text-color-placeholder)}
.lc-tree-search-input::-webkit-search-cancel-button,.lc-tree-search-input::-webkit-search-decoration{-webkit-appearance:none;appearance:none}
.lc-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0;border-top:1px solid var(--td-component-border)}
.lc-setting-copy{min-width:0}
.lc-setting-label{font:var(--td-font-body-medium);font-weight:500;color:var(--td-text-color-primary)}
.lc-setting-desc{margin-top:3px;font-size:12px;line-height:1.5;color:var(--td-text-color-secondary)}
.lc-switch{position:relative;display:inline-flex;align-items:center;height:20px;min-width:32px;flex:0 0 auto;padding:0;border:0;border-radius:var(--td-radius-round,999px);background:var(--td-bg-color-component);cursor:pointer;transition:background-color .2s cubic-bezier(.38,0,.24,1)}
.lc-switch:hover{background:var(--td-bg-color-component-hover)}
.lc-switch-handle{position:absolute;left:4px;top:4px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:var(--td-shadow-1);transition:left .2s cubic-bezier(.38,0,.24,1)}
.lc-switch-on{background:var(--td-brand-color)}
.lc-switch-on:hover{background:var(--td-brand-color-hover)}
.lc-switch-on .lc-switch-handle{left:calc(100% - 16px)}
.lc-switch:active .lc-switch-handle{width:16px}
.lc-switch:focus-visible{outline:2px solid var(--td-brand-color-focus);outline-offset:2px}
.lc-tree{overflow:auto;flex:1;min-width:0;padding:8px;scrollbar-width:thin}
.lc-tree-busy{font-size:12px;line-height:20px;color:var(--td-text-color-secondary);padding:4px 8px}
.lc-tree{padding:6px 8px 10px}
.lc-left-foot{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px 6px;border-top:1px solid var(--td-component-stroke)}
.lc-foot-left,.lc-foot-right{display:flex;align-items:center;gap:8px;flex:0 0 auto;min-width:0}
.lc-plugin-version{flex:0 0 auto;min-width:0;padding:4px 0;font-size:11px;line-height:16px;color:var(--td-text-color-placeholder);user-select:none}
.lc-pinned{padding:0 0 6px;margin:0 0 6px;border-bottom:1px solid var(--td-component-stroke)}
.lc-pinned-head{display:flex;align-items:center;height:28px;padding:0 16px;color:var(--td-text-color-placeholder);font-size:12px;line-height:20px}
.lc-pinned-row{padding-left:16px}
.lc-pinned-icon{color:var(--td-brand-color)}
.lc-pinned-unpin{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-right:2px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--td-text-color-placeholder);cursor:pointer;opacity:0;transition:opacity .15s,color .15s,background-color .15s}
.lc-pinned-row:hover .lc-pinned-unpin{opacity:1}
.lc-pinned-unpin:hover{background:var(--td-bg-color-container-hover);color:var(--td-text-color-primary)}
.lc-tree-pin{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:2px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--td-text-color-placeholder);cursor:pointer;opacity:0;flex:0 0 auto;transition:opacity .15s,color .15s,background-color .15s}
.lc-tree-row:hover .lc-tree-pin{opacity:1}
.lc-tree-pin:hover{background:var(--td-bg-color-container-hover);color:var(--td-brand-color)}
.lc-tree-pin-active{opacity:1;color:var(--td-brand-color)}
.lc-tree-head{display:flex;align-items:center;gap:8px;flex:0 0 auto;height:28px;padding:0 16px;color:var(--td-text-color-placeholder);font-size:12px;line-height:20px}
.lc-tree-head-btn{display:inline-flex;align-items:center;gap:4px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
.lc-tree-head-btn:hover{color:var(--td-text-color-primary)}
.lc-tree-head-active{color:var(--td-text-color-secondary)}
.lc-tree-head-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-tree-head-arrow{display:inline-flex;color:var(--lc-icon-brand)}
.lc-tree-head-btn:first-child{margin-right:auto}
.lc-tree-head-toggle{flex:0 0 auto;padding:0 4px;color:var(--td-text-color-placeholder)}
.lc-tree-head-toggle:hover{color:var(--td-text-color-primary)}
.lc-tree-head-toggle:disabled{opacity:.45;cursor:default}
.lc-tree-head-status{margin-left:4px;min-width:62px;justify-content:flex-end}
.lc-tree-row{display:flex;align-items:center;gap:8px;height:34px;padding:0 8px;border-radius:6px;cursor:pointer;user-select:none;min-width:0;overflow:hidden;transition:background-color .12s linear}
.lc-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.lc-tree-project{font-weight:500}
.lc-tree-project .lc-name{color:var(--td-text-color-primary)}
.lc-tree-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;color:var(--lc-icon)}
.lc-tree-icon-open{color:var(--lc-icon-brand)}
.lc-tree-icon-folder{display:inline-flex;align-items:center;justify-content:center}
.lc-tree-icon-caret{display:none;align-items:center;justify-content:center;color:var(--lc-icon)}
.lc-tree-project:hover .lc-tree-icon-folder{display:none}
.lc-tree-project:hover .lc-tree-emoji{display:none}
.lc-tree-emoji{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;font-size:15px;line-height:18px}
.lc-context-emoji{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;font-size:13px;line-height:14px}
.lc-emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}
.lc-emoji-option{height:32px;border:1px solid var(--td-component-stroke);border-radius:6px;background:var(--td-bg-color-container);font-size:17px;line-height:30px;cursor:pointer}
.lc-emoji-option:hover{border-color:var(--td-brand-color);background:var(--td-bg-color-container-hover)}
.lc-emoji-option-active{border-color:var(--td-brand-color);background:var(--td-brand-color-light)}
.lc-link-btn{align-self:flex-start;padding:0;border:0;background:transparent;color:var(--td-text-color-brand);font-size:12px;cursor:pointer}
.lc-link-btn:hover{text-decoration:underline}
.lc-link-btn:disabled{color:var(--td-text-color-placeholder);cursor:default;text-decoration:none}
.lc-field-extra{display:flex;align-items:center;gap:10px;margin-top:6px}
.lc-field-hint{font-size:11px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-tree-project:hover .lc-tree-icon-caret{display:inline-flex}
.lc-tree-children-wrap{display:grid;grid-template-rows:0fr;transition:grid-template-rows .22s cubic-bezier(.4,0,.2,1)}
.lc-tree-children-wrap.lc-tree-children-open{grid-template-rows:1fr}
.lc-tree-children{display:flex;flex-direction:column;gap:1px;margin:0;padding-left:26px;overflow:hidden;min-height:0;opacity:0;transition:opacity .18s ease}
.lc-tree-children-wrap.lc-tree-children-open .lc-tree-children{opacity:1}
.lc-tree-children .lc-empty{padding:4px 4px 4px 8px;text-align:left}
.lc-tree-exec{height:32px;font-weight:400}
.lc-tree-exec .lc-name{color:var(--td-text-color-secondary)}
.lc-tree-exec:hover .lc-name{color:var(--td-text-color-primary)}
.lc-tree-exec.lc-active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.1))}
.lc-tree-exec.lc-active .lc-name{color:var(--td-text-color-primary);font-weight:500}
.lc-tree-exec.lc-active .lc-status{color:var(--td-text-color-secondary)}
.lc-tree-closed .lc-name{color:var(--td-text-color-placeholder)}
.lc-tree-closed .lc-tree-icon{opacity:.75}
.lc-name{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--td-font-body-medium)}
.lc-status{flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:62px;font-size:12px;line-height:20px;color:var(--td-text-color-placeholder);white-space:nowrap}
.lc-dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex:0 0 auto;background:var(--dsw-alias-state-idle-primary,var(--td-text-color-disabled))}
.lc-dot-success{background:var(--dsw-alias-state-success-primary,var(--td-success-color))}
.lc-dot-warn{background:var(--dsw-alias-state-warn-primary,var(--td-warning-color))}
.lc-dot-error{background:var(--dsw-alias-state-error-primary,var(--td-error-color))}
.lc-empty{padding:16px;color:var(--td-text-color-placeholder);text-align:center;font:var(--td-font-body-medium)}
.lc-empty-sm{padding:4px 8px;text-align:left;font:var(--td-font-body-small)}
.lc-main-head{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;padding:0 16px;border-bottom:1px solid var(--td-component-stroke);min-height:48px;min-width:0;overflow:hidden;-webkit-app-region:drag}
.lc-tabs{display:flex;align-items:stretch;gap:0;flex:0 0 auto;min-width:0;align-self:stretch;-webkit-app-region:no-drag;overflow-x:auto;scrollbar-width:none}
.lc-tabs::-webkit-scrollbar{display:none}
.lc-tab{position:relative;display:inline-flex;align-items:center;gap:6px;height:48px;padding:0 16px;border:0;background:transparent;color:var(--td-text-color-secondary);cursor:pointer;font:var(--td-font-body-medium);white-space:nowrap;transition:background-color .2s linear}
.lc-tab:hover{background:var(--td-bg-color-container-hover)}
.lc-tab:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--td-brand-color-focus)}
.lc-tab-active{color:var(--td-brand-color);text-shadow:0 0 .3px currentcolor}
.lc-tab-active:after{content:'';position:absolute;left:12px;right:12px;bottom:0;height:3px;border-radius:var(--td-radius-small) var(--td-radius-small) 0 0;background:var(--td-brand-color)}
.lc-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:var(--lc-radius);background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-secondary);font:var(--td-font-body-small);font-size:12px;line-height:18px}
.lc-tab-active .lc-count{background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-main-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;flex:0 1 auto;padding:8px 0;margin-left:auto;-webkit-app-region:no-drag}
.lc-view-switch{display:inline-flex;align-items:center;flex:0 0 auto;gap:2px;padding:2px;border:1px solid var(--td-border-level-2-color);border-radius:var(--td-radius-round,999px);background:var(--td-bg-color-container);-webkit-app-region:no-drag}
.lc-view-btn{height:24px;padding:0 10px;border:0;border-radius:var(--td-radius-round,999px);background:transparent;color:var(--td-text-color-secondary);cursor:pointer;font-size:12px;line-height:24px;white-space:nowrap;transition:background-color .15s,color .15s}
.lc-view-btn:hover{color:var(--td-text-color-primary)}
.lc-view-btn-active{background:var(--td-brand-color-light);color:var(--td-text-color-brand);font-weight:500}
.lc-main-dashboard .lc-main-head,.lc-main-dashboard .lc-table-wrap{display:none}
.lc-main-team .lc-main-head,.lc-main-team .lc-table-wrap{display:none}
.lc-main-team{overflow:hidden}
.lc-team-wrap{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--td-bg-color-container);overflow:hidden}
.lc-team{flex:1;min-height:0;display:flex;flex-direction:column;padding:0;gap:0;min-width:0}
.lc-team-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;flex:0 0 auto;padding:0 16px 6px;border-bottom:1px solid var(--td-component-stroke);-webkit-app-region:drag}
.lc-team-head .lc-tabs,.lc-team-head .lc-team-actions,.lc-team-head button,.lc-team-head select,.lc-team-head a{-webkit-app-region:no-drag}
.lc-team-title-wrap{display:flex;align-items:stretch;min-width:0}
.lc-team-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto;margin-left:auto}
.lc-team-export{height:30px;padding:0 14px;font-size:12px}
.lc-team-new{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;font-size:12px;white-space:nowrap}
.lc-team-new svg{flex:0 0 auto}
.lc-team-filters{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:0 0 auto;margin:0;padding:10px 16px;border:0;border-bottom:1px solid var(--td-component-stroke);border-radius:0;background:transparent}
.lc-team-filter-label{font-size:12px;line-height:18px;color:var(--td-text-color-secondary);white-space:nowrap}
.lc-team-input{box-sizing:border-box;height:30px;min-height:30px;padding:0 8px;border:1px solid var(--td-component-stroke);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font-size:12px;line-height:28px;outline:none}
.lc-team-input:focus{border-color:var(--td-brand-color)}
.lc-team-select{width:128px;flex:0 0 auto}
.lc-team-execution-select{width:auto;min-width:144px;max-width:220px}
.lc-team-col-check{width:36px;min-width:36px;max-width:36px;padding-left:12px!important;padding-right:0!important;text-align:center}
.lc-team-check{display:inline-flex;align-items:center;justify-content:center;margin-right:6px;vertical-align:middle;cursor:pointer}
.lc-team-check input{width:14px;height:14px;margin:0;accent-color:var(--td-brand-color);cursor:pointer}
.lc-team-col-id{white-space:nowrap}
.lc-team-bulk{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 16px;border-bottom:1px solid var(--td-component-stroke);background:var(--td-brand-color-light)}
.lc-team-bulk-count{font-size:12px;font-weight:600;color:var(--td-brand-color);white-space:nowrap}
.lc-team-bulk-select{width:auto;min-width:132px;max-width:220px}
.lc-team-bulk-date{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--td-text-color-secondary);white-space:nowrap}
.lc-team-bulk-date .lc-team-input{width:132px}
.lc-chip-btn.lc-chip-btn-active,.lc-chip-btn.lc-chip-btn-active:hover{background:var(--td-brand-color-light);border-color:var(--td-brand-color);color:var(--td-brand-color)}
.lc-team-range{display:flex;align-items:center;gap:6px;height:30px;min-width:250px;padding:0 8px;border:1px solid var(--td-component-stroke);border-radius:6px;background:var(--td-bg-color-container);box-sizing:border-box}
.lc-team-range:focus-within{border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-focus)}
.lc-team-range-text{width:96px;min-width:0;padding:0;border:0;background:transparent;color:var(--td-text-color-primary);font-size:12px;line-height:28px;outline:none;cursor:pointer}
.lc-team-range-text::placeholder{color:var(--td-text-color-placeholder)}
.lc-team-range-sep{color:var(--td-text-color-placeholder)}
.lc-team-range-icon{display:inline-flex;align-items:center;color:var(--td-text-color-placeholder);margin-left:auto}
.lc-team-picker{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0}
.lc-team-search{flex:1 1 160px;min-width:120px;width:auto;padding:0 10px}
.lc-team-overview{flex:0 0 auto;margin:14px 16px 4px;padding:0;border:0;border-radius:0;background:transparent}
.lc-team-overview-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.lc-team-overview-title{font-size:13px;font-weight:600;color:var(--td-text-color-primary)}
.lc-team-overview-hint{font-size:11px;color:var(--td-text-color-placeholder)}
.lc-team-cards{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:12px;align-items:stretch}
.lc-team-card{flex:0 1 180px;width:180px;max-width:100%;min-width:0}
.lc-team-card{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;min-height:112px;padding:14px 18px 12px 20px;border:1px solid var(--td-component-stroke);border-radius:16px;background:var(--td-bg-color-container);box-shadow:0 2px 8px rgba(0,0,0,.06);transition:box-shadow .2s,border-color .2s,transform .2s}
.lc-team-card::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 3px 3px 0;background:var(--lc-card-accent,var(--lc-brand))}
.lc-team-card:hover{box-shadow:0 6px 16px rgba(0,0,0,.12);border-color:var(--td-border-level-2-color);transform:translateY(-1px)}
.lc-team-card-name{font-size:13px;line-height:18px;color:var(--td-text-color-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-team-card-metrics{display:flex;align-items:flex-end;justify-content:flex-start;gap:24px;margin-top:2px}
.lc-team-card-metric{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:0;border:0;background:transparent;font:inherit;text-align:left;cursor:pointer;border-radius:4px}
.lc-team-card > .lc-team-card-metric{width:100%;align-items:center}
.lc-team-card-metric:hover .lc-team-card-value{text-decoration:underline}
.lc-team-card-value{font-size:26px;line-height:32px;font-weight:600;color:var(--td-text-color-primary)}
.lc-team-card-value-todo{color:var(--lc-brand)}
.lc-team-card-value-done{color:#2ba471}
.lc-team-card-label{font-size:12px;line-height:16px;color:var(--td-text-color-placeholder);white-space:nowrap}
.lc-team-overview-empty{padding:18px 0;text-align:center;color:var(--td-text-color-placeholder);font-size:12px}
.lc-team-error{margin:0;color:var(--td-error-color);font-size:12px}
.lc-team-body{flex:1;min-height:0;overflow:auto;border:0;border-radius:0;background:var(--td-bg-color-container)}
.lc-team-loading,.lc-team-empty{display:flex;align-items:center;justify-content:center;height:100%;min-height:160px;color:var(--td-text-color-placeholder);font-size:13px}
.lc-table.lc-table-team{table-layout:fixed;min-width:860px}
.lc-table-team .lc-team-col-title a{color:var(--td-text-color-primary);text-decoration:none}
.lc-table-team .lc-team-col-title a:hover{color:var(--td-text-color-brand);text-decoration:underline}
.lc-table-team tbody tr{cursor:default}
.lc-table-team td.lc-cell-editable{cursor:pointer}
.lc-table-team td.lc-cell-editable:hover{background:var(--td-bg-color-container-hover)}
.lc-team-pager .lc-chip-btn{height:26px;padding:0 10px;font-size:12px}
.lc-team-pager .lc-chip-btn:disabled{opacity:.45;cursor:default;color:var(--td-text-color-placeholder);border-color:var(--td-component-stroke)}
.lc-team-row-overdue .lc-team-date-value{display:inline-block}
.lc-team-date-overdue{display:inline-block;padding:2px 8px;border-radius:4px;background:#e34d59;color:#fff;font-weight:600;line-height:18px}
.lc-team-overdue-text{color:#e34d59;font-weight:600}
.lc-team-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 auto;padding:10px 16px 12px;border-top:1px solid var(--td-component-stroke);font-size:12px;color:var(--td-text-color-secondary)}
.lc-team-pager-right{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.lc-team-page-size{width:112px;height:30px;min-height:30px;font-size:12px;padding:0 6px;flex:0 0 auto}
.lc-page-btn{min-width:30px;height:30px;padding:0 8px;border:1px solid var(--td-component-stroke);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font-size:12px;line-height:28px;cursor:pointer}
.lc-page-btn:hover{border-color:var(--td-brand-color);color:var(--td-brand-color)}
.lc-page-btn-active,.lc-page-btn-active:hover{background:var(--td-brand-color);border-color:var(--td-brand-color);color:#fff}
.lc-page-arrow{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--td-text-color-secondary);cursor:pointer}
.lc-page-arrow:hover:not(:disabled){background:var(--td-bg-color-container-hover);color:var(--td-text-color-primary)}
.lc-page-arrow:disabled{opacity:.4;cursor:default}
.lc-page-ellipsis{min-width:18px;text-align:center;color:var(--td-text-color-placeholder)}
.lc-main-dashboard{overflow:hidden}
.lc-dashboard{flex:1;min-height:0;overflow:auto;padding:20px 20px 28px;background:var(--td-bg-color-container)}
.lc-dash-inner{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.lc-dash-dragbar{height:12px;margin:-20px -20px -4px;-webkit-app-region:drag;flex:0 0 auto}
.lc-dash-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;-webkit-app-region:drag;padding:2px 0 4px;margin:0 -20px;padding-left:20px;padding-right:20px;cursor:default}
.lc-dash-top .lc-icon-btn{-webkit-app-region:no-drag}
.lc-dash-title{font-size:18px;font-weight:600;color:var(--td-text-color-primary)}
.lc-dash-sub{margin-top:4px;font-size:12px;color:var(--td-text-color-secondary)}
.lc-dash-error{margin-top:2px;padding:10px 14px;border:1px solid var(--td-error-color-3, #ffd3d0);border-radius:var(--td-radius-default,6px);background:var(--td-error-color-1, #fff0ef);color:var(--td-error-color);font-size:12px}
.lc-dash-loading{padding:28px 0;color:var(--td-text-color-secondary);font-size:13px}
.lc-dash-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.lc-dash-card{position:relative;border:1px solid var(--td-component-stroke);border-radius:16px;background:var(--td-bg-color-container);padding:16px 18px 16px 20px;display:flex;flex-direction:column;gap:8px;min-width:0;box-shadow:0 2px 8px rgba(0,0,0,.06);transition:box-shadow .2s,border-color .2s,transform .2s}
.lc-dash-card:hover{box-shadow:0 6px 16px rgba(0,0,0,.12);border-color:var(--td-border-level-2-color);transform:translateY(-1px)}
.lc-dash-card::before{content:'';position:absolute;left:0;top:16px;bottom:16px;width:3px;border-radius:0 3px 3px 0;background:var(--td-brand-color)}
.lc-dash-card-bug::before{background:var(--td-error-color)}
.lc-dash-card-task::before{background:var(--td-warning-color)}
.lc-dash-card-label{font-size:13px;color:var(--td-text-color-secondary)}
.lc-dash-card-count{font-size:30px;line-height:1;font-weight:600;color:var(--td-text-color-primary);font-variant-numeric:tabular-nums}
.lc-dash-card-meta{font-size:12px;color:var(--td-text-color-placeholder)}
.lc-dash-lists{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.lc-dash-list{border:1px solid var(--td-component-stroke);border-radius:16px;background:var(--td-bg-color-container);display:flex;flex-direction:column;min-width:0;height:260px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.lc-dash-list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.18);font-size:13px;font-weight:600;color:#fff;flex:0 0 auto}
.lc-dash-list-head-story{background:var(--lc-brand)}
.lc-dash-list-head-bug{background:#e34d59}
.lc-dash-list-head-task{background:#ed7b2f}
.lc-dash-list-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border-radius:20px;background:rgba(255,255,255,.22);color:#fff;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}
.lc-dash-list-body{flex:1;min-height:0;overflow:auto;padding:4px 0;scrollbar-width:thin}
.lc-dash-row{display:flex;align-items:center;gap:10px;padding:9px 14px;text-decoration:none;color:var(--td-text-color-primary)}
.lc-dash-overdue-badge{position:absolute;top:14px;right:16px;padding:1px 8px;border-radius:10px;background:#e34d59;color:#fff;font-size:11px;line-height:18px;font-weight:500;z-index:1}
.lc-dash-row-overdue{flex:0 0 auto;color:#e34d59;font-size:12px;font-weight:600;line-height:18px}
.lc-dash-row-dot{flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:var(--td-brand-color)}
.lc-dash-dot-story{background:var(--lc-brand)}
.lc-dash-dot-bug{background:#e34d59}
.lc-dash-dot-task{background:#ed7b2f}
.lc-dash-row:hover{background:var(--td-bg-color-container-hover)}
.lc-dash-row-title{flex:1;min-width:0;font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-dash-row-date{flex:0 0 auto;font-size:12px;color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums}
.lc-dash-empty{padding:18px 14px;font-size:12px;color:var(--td-text-color-placeholder)}
@container (max-width: 720px){
.lc-dash-lists{grid-template-columns:1fr}
}
@container (max-width: 440px){
.lc-dash-cards{grid-template-columns:1fr}
}
.lc-cal{flex:1 1 auto;width:100%;height:100%;min-width:0;min-height:0;border:0;border-radius:0;background:var(--lc-brand);display:flex;flex-direction:column;overflow:hidden;box-shadow:none}
.lc-cal-head{display:flex;align-items:center;justify-content:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.18);background:var(--lc-brand);flex-wrap:wrap;color:#fff}
.lc-cal-head .lc-icon-btn{color:rgba(255,255,255,.9)}
.lc-cal-head .lc-icon-btn:hover{background:rgba(255,255,255,.16);color:#fff}
.lc-cal-title-line{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.lc-cal-title{font-size:14px;font-weight:600;color:#fff}
.lc-cal-sub{margin-top:3px;font-size:12px;color:rgba(255,255,255,.78)}
.lc-cal-mode-slot{display:flex;align-items:center;margin-left:20px;flex:0 0 auto}
.lc-cal-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.lc-cal-actions>*{flex:0 0 auto}
.lc-cal-mode{display:inline-flex;gap:2px;padding:2px;border:1px solid rgba(255,255,255,.45);border-radius:var(--td-radius-round,999px);background:rgba(255,255,255,.12)}
.lc-cal-mode-btn{height:24px;padding:0 10px;border:0;border-radius:var(--td-radius-round,999px);background:transparent;color:rgba(255,255,255,.9);cursor:pointer;font-size:12px;line-height:24px;white-space:nowrap;transition:background-color .15s,color .15s}
.lc-cal-mode-btn:hover{background:rgba(255,255,255,.18);color:#fff}
.lc-cal-mode-btn-active{background:#fff;color:var(--lc-brand);font-weight:500}
.lc-cal-month{min-width:104px;padding:0 4px;text-align:center;font-size:13px;font-weight:500;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.lc-cal-today-btn{height:28px;padding:0 10px;white-space:nowrap;border:1px solid rgba(255,255,255,.55);border-radius:var(--td-radius-round,999px);background:transparent;color:#fff;cursor:pointer;font-size:12px}
.lc-cal-today-btn:hover{background:rgba(255,255,255,.16);border-color:#fff;color:#fff}
.lc-cal-title-line{display:flex;align-items:center;gap:12px;min-width:0}
.lc-cal-done-toggle{display:inline-flex;align-items:center;gap:5px;color:rgba(255,255,255,.92);font-size:11px;line-height:16px;cursor:pointer;user-select:none;white-space:nowrap}
.lc-cal-done-toggle input{width:14px;height:14px;margin:0;accent-color:#fff;cursor:pointer}
.lc-cal-error{padding:8px 14px;background:rgba(0,0,0,.18);color:#fff;font-size:12px}
.lc-cal-filter-note{padding:8px 16px;font-size:12px;color:var(--td-text-color-secondary);background:var(--td-bg-color-container-hover);border-bottom:1px solid var(--td-component-stroke)}
.lc-cal-grid-week .lc-cal-col-last{border-right:0}
.lc-cal-grid{display:grid;width:100%;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:auto repeat(6,minmax(0,1fr));flex:1 1 auto;min-height:0;border-top:0;border-radius:12px 12px 0 0;overflow:hidden;background:var(--td-bg-color-container)}
.lc-cal-week{padding:8px 10px;font-size:12px;font-weight:500;color:var(--td-text-color-placeholder);text-align:center;border-bottom:1px solid var(--td-component-stroke);border-right:1px solid var(--td-component-stroke)}
.lc-cal-grid:not(.lc-cal-grid-week) .lc-cal-week:nth-child(7){border-right:0}
.lc-cal-week-weekend{color:var(--td-text-color-placeholder);background:#fafafa}
body[data-ds-dark-theme] .lc-root .lc-cal-cell,
body[data-ds-dark-theme] .lc-root .lc-cal-week{background:var(--td-bg-color-container)}
body[data-ds-dark-theme] .lc-root .lc-cal-weekend,
body[data-ds-dark-theme] .lc-root .lc-cal-week-weekend{background:#202124}
body[data-ds-dark-theme] .lc-root .lc-cal-blank{background:#181818}
body[data-ds-dark-theme] .lc-root .lc-cal-cell:hover,
body[data-ds-dark-theme] .lc-root .lc-cal-weekend:hover{background:#2a3550}
body[data-ds-dark-theme] .lc-root .lc-cal-task{background:#253549;color:#a9c7ff}
body[data-ds-dark-theme] .lc-root .lc-cal-task:hover{background:#2d4262;border-color:var(--td-brand-color)}
body[data-ds-dark-theme] .lc-root .lc-cal-task-done{background:#2c2c2c;color:rgba(255,255,255,.42)}
body[data-ds-dark-theme] .lc-root .lc-cal-task-done .lc-cal-task-link{color:rgba(255,255,255,.42)}
body[data-ds-dark-theme] .lc-root .lc-cal-task-inactive{background:#2c2c2c;color:rgba(255,255,255,.42)}
body[data-ds-dark-theme] .lc-root .lc-cal-task-inactive:hover{background:#343434;color:rgba(255,255,255,.42)}
body[data-ds-dark-theme] .lc-root .lc-cal-task-inactive .lc-cal-task-link{color:rgba(255,255,255,.42)}
body[data-ds-dark-theme] .lc-root .lc-cal-day-num{color:rgba(255,255,255,.78)}
body[data-ds-dark-theme] .lc-root .lc-cal-lunar{color:rgba(255,255,255,.44)}
body[data-ds-dark-theme] .lc-root .lc-cal-lunar-festival{color:#ff8a80}
body[data-ds-dark-theme] .lc-root .lc-cal-lunar-term{color:#6fdc9e}
body[data-ds-dark-theme] .lc-root .lc-cal-selected{box-shadow:inset 0 0 0 2px var(--td-brand-color)}
body[data-ds-dark-theme] .lc-root .lc-cal-today .lc-cal-day-num{background:var(--td-brand-color);color:#fff}
.lc-cal-cell{height:auto;min-height:0;padding:6px 8px;border-bottom:1px solid var(--td-component-stroke);border-right:1px solid var(--td-component-stroke);display:flex;flex-direction:column;gap:4px;min-width:0;background:var(--td-bg-color-container);transition:background-color .15s;overflow:hidden;box-sizing:border-box}
.lc-cal-grid:not(.lc-cal-grid-week) .lc-cal-cell:nth-child(7n){border-right:0}
.lc-cal-cell:hover{background:var(--td-brand-color-light,#f2f3ff)}
.lc-cal-weekend{background:#fafafa}
.lc-cal-weekend:hover{background:var(--td-brand-color-light,#f2f3ff)}
.lc-cal-blank{background:#fafafa}
.lc-cal-blank:hover{background:var(--td-bg-color-page)}
.lc-cal-day{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.lc-cal-day-left{display:flex;align-items:center;gap:4px;min-width:0}
.lc-cal-lunar{font-size:11px;line-height:16px;color:var(--td-text-color-placeholder);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.lc-cal-lunar-festival{color:#d54941}
.lc-cal-lunar-term{color:#2ba471}
.lc-cal-day-week{font-size:11px;color:var(--td-text-color-placeholder)}
.lc-cal-holiday{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;border-radius:4px;color:#fff;font-size:10px;line-height:16px;font-weight:500;box-sizing:border-box}
.lc-cal-holiday-rest{background:var(--lc-brand)}
.lc-cal-holiday-work{background:#e34d59}
.lc-cal-grid-week{grid-template-rows:auto minmax(0,1fr)}
.lc-cal-grid-week .lc-cal-cell{height:auto;min-height:0}
.lc-cal-day-num{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:50%;font-size:12px;color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums}
.lc-cal-today .lc-cal-day-num{background:var(--td-brand-color);color:#fff;font-weight:600}
.lc-cal-selected{box-shadow:inset 0 0 0 2px var(--td-brand-color-focus, rgba(0,82,217,.35))}
.lc-cal-tasks{display:flex;flex-direction:column;gap:8px;overflow:hidden;margin-top:2px}
.lc-cal-tasks-month{gap:4px;margin-top:1px}
.lc-cal-task-month{padding:2px 6px;line-height:14px;font-size:11px;max-height:20px;flex:0 0 auto}
.lc-cal-task{display:block;padding:4px 8px;border-radius:6px;background:var(--td-brand-color-light);color:var(--td-text-color-brand);font-size:12px;line-height:16px;text-decoration:none;cursor:grab;border:1px solid transparent;transition:background-color .15s,border-color .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none}
.lc-cal-task-link{display:block;color:inherit;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-cal-task-week{display:flex;align-items:flex-start;gap:6px;white-space:normal;padding:4px 8px}
.lc-cal-task-week .lc-cal-task-link{flex:1;min-width:0;white-space:normal;word-break:break-all;max-height:32px;overflow:hidden}
.lc-cal-task-check{width:13px;height:13px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--td-brand-color);cursor:pointer}
.lc-cal-task-done,.lc-cal-task-done:hover{background:var(--td-bg-color-container-hover);border-color:transparent;color:var(--td-text-color-placeholder);cursor:grab;box-shadow:none}
.lc-cal-task-done:active{cursor:grabbing}
.lc-cal-task-check:disabled{pointer-events:none;cursor:grab}
.lc-cal-task-done .lc-cal-task-link{color:var(--td-text-color-placeholder)}
.lc-cal-task:hover{background:var(--td-brand-color-light, #e3f2fd);border-color:var(--td-brand-color);color:var(--td-text-color-brand)}
.lc-cal-task-inactive,.lc-cal-task-inactive:hover{background:var(--td-bg-color-container-hover);border-color:transparent;color:var(--td-text-color-placeholder);box-shadow:none}
.lc-cal-task-inactive .lc-cal-task-link{color:var(--td-text-color-placeholder)}
.lc-cal-task-mark{width:14px;height:14px;margin:1px 0 0;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border:1px solid #b9c0c8;border-radius:3px;background:#e3e6ea;color:#6f7782;box-sizing:border-box;line-height:1}
.lc-cal-task:active{cursor:grabbing}
.lc-cal-task.lc-cal-task-dragging{opacity:.55;border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-light);cursor:grabbing}
.lc-cal-task.lc-cal-task-drop-before{box-shadow:inset 0 2px 0 var(--td-brand-color)}
.lc-cal-task.lc-cal-task-drop-after{box-shadow:inset 0 -2px 0 var(--td-brand-color)}

.lc-day-view{display:grid;width:100%;grid-template-columns:minmax(0,1fr) 5px var(--lc-day-detail-w,300px);align-items:stretch;flex:1 1 auto;background:var(--td-bg-color-container);min-height:0;overflow:hidden;border-radius:12px 12px 0 0}
.lc-day-view .lc-day-detail{border-left:0}
.lc-day-scroll{min-width:0;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:var(--td-scrollbar-color) transparent}
.lc-day-scroll::-webkit-scrollbar{width:8px}
.lc-day-scroll::-webkit-scrollbar-thumb{background:var(--td-scrollbar-color);border-radius:8px}
.lc-day-scroll::-webkit-scrollbar-thumb:hover{background:var(--td-scrollbar-hover-color)}
.lc-day-scroll::-webkit-scrollbar-track{background:transparent}
.lc-day-canvas{display:grid;grid-template-columns:56px minmax(0,1fr);position:relative}
.lc-day-axis{position:relative;border-right:1px solid var(--td-component-stroke);background:#fff;box-sizing:border-box}
.lc-day-slot{position:relative;box-sizing:border-box;border-bottom:1px solid rgba(15,23,42,.06)}
.lc-day-slot>span{position:absolute;top:-7px;right:6px;font-size:10px;line-height:14px;color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums;background:#fff;padding:0 1px;z-index:1}
.lc-day-slot:first-child>span{top:2px}
.lc-day-lane{position:relative;overflow:hidden;box-sizing:border-box;border-right:1px solid var(--td-component-stroke);background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 27px,rgba(15,23,42,.055) 27px,rgba(15,23,42,.055) 28px),repeating-linear-gradient(to bottom,transparent 0,transparent 55px,rgba(15,23,42,.1) 55px,rgba(15,23,42,.1) 56px);background-color:var(--td-bg-color-container)}
.lc-day-now-line{position:absolute;left:0;right:0;height:2px;background:#e34d59;z-index:3;pointer-events:none;box-shadow:0 0 0 1px rgba(227,77,89,.12)}
.lc-day-now-label{position:absolute;left:5px;transform:translateY(-50%);z-index:4;padding:1px 5px;border-radius:4px;background:#e34d59;color:#fff;font-size:9px;line-height:14px;font-weight:600;font-variant-numeric:tabular-nums;pointer-events:none}
.lc-day-empty{position:absolute;left:50%;top:120px;transform:translateX(-50%);font-size:12px;color:var(--td-text-color-placeholder);pointer-events:none;white-space:nowrap}
.lc-day-event{position:absolute;z-index:2;box-sizing:border-box;padding:4px 7px 3px;border-radius:7px;border:1px solid transparent;border-bottom:2px solid #fff;border-left:3px solid var(--td-brand-color);background:var(--td-brand-color-light);color:var(--td-text-color-brand);cursor:grab;overflow:hidden;transition:background-color .15s,border-color .15s,box-shadow .15s;user-select:none;touch-action:none}
.lc-day-event:hover{background:var(--td-brand-color-light-hover,#e0ecff);border-color:var(--td-brand-color);box-shadow:0 2px 8px rgba(0,82,217,.14)}
.lc-day-event-selected{box-shadow:0 0 0 2px var(--td-brand-color),0 2px 8px rgba(0,82,217,.14)}
.lc-day-event-dragging{cursor:grabbing;z-index:6;opacity:.96;box-shadow:0 8px 20px rgba(15,23,42,.18)}
.lc-day-event-head{display:flex;align-items:flex-start;gap:5px;min-width:0}
.lc-day-event-check{width:12px;height:12px;margin:2px 0 0;flex:0 0 auto;accent-color:var(--td-brand-color);cursor:pointer}
.lc-day-event-mark{width:12px;height:12px;margin:2px 0 0;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border:1px solid #b9c0c8;border-radius:3px;background:#e3e6ea;color:#6f7782;box-sizing:border-box;line-height:1}
.lc-day-event-title{flex:1;min-width:0;font-size:12px;line-height:15px;font-weight:500;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-all}
.lc-day-event-time{display:block;margin-top:2px;font-size:10px;line-height:13px;color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-day-event-short{display:flex;align-items:center;gap:6px;padding:2px 6px}
.lc-day-event-short .lc-day-event-head{flex:1 1 auto;min-width:0;align-items:center;gap:4px}
.lc-day-event-short .lc-day-event-time{display:block;flex:0 0 auto;margin-top:0;font-size:9px;line-height:12px}
.lc-day-event-short .lc-day-event-title{-webkit-line-clamp:1;line-height:14px}
.lc-day-event-done,.lc-day-event-done:hover{background:var(--td-bg-color-container-hover);border-color:transparent;color:var(--td-text-color-placeholder);border-left-color:var(--td-text-color-placeholder)}
.lc-day-event-done .lc-day-event-title{color:var(--td-text-color-placeholder)}
.lc-day-event-inactive,.lc-day-event-inactive:hover{background:var(--td-bg-color-container-hover);border-color:transparent;color:var(--td-text-color-placeholder);border-left-color:var(--td-text-color-placeholder)}
.lc-day-event-inactive .lc-day-event-title{color:var(--td-text-color-placeholder)}
.lc-day-event.lc-day-event-dropped{background:var(--td-bg-color-container-hover)}
.lc-day-event-done,.lc-day-event-done:hover,.lc-day-event-inactive,.lc-day-event-inactive:hover,.lc-day-event.lc-day-event-dropped{border-bottom-color:#fff}
.lc-day-resize{position:absolute;left:0;right:0;height:7px;z-index:4;cursor:ns-resize;touch-action:none}
.lc-day-resize-top{top:0;border-radius:7px 7px 0 0}
.lc-day-resize-bottom{bottom:0;border-radius:0 0 7px 7px}
.lc-day-resize:after{content:'';position:absolute;left:12px;right:12px;height:2px;border-radius:2px;background:transparent;transition:background-color .15s}
.lc-day-resize-top:after{top:2px}
.lc-day-resize-bottom:after{bottom:2px}
.lc-day-event:hover .lc-day-resize:after{background:rgba(0,82,217,.28)}
.lc-day-resize:hover:after{background:var(--td-brand-color)}
.lc-day-detail{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:auto;box-sizing:border-box;padding:14px 14px 16px;background:var(--td-bg-color-container);border-left:1px solid var(--td-component-stroke)}
.lc-day-detail-empty{display:flex;flex-direction:column;justify-content:flex-start;padding-top:26px}
.lc-day-detail-empty-title{font-size:13px;font-weight:600;color:var(--td-text-color-primary);margin-bottom:8px}
.lc-day-detail-empty p{margin:0;font-size:12px;line-height:19px;color:var(--td-text-color-placeholder)}
.lc-day-detail-loading{font-size:12px;color:var(--td-text-color-placeholder)}
.lc-day-detail-head{display:flex;flex:0 0 auto;align-items:flex-start;gap:10px;margin-bottom:8px}
.lc-day-detail-title{flex:1;min-width:0;font-size:14px;line-height:20px;font-weight:600;color:var(--td-text-color-primary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-all}
.lc-day-detail-open{flex:0 0 auto;font-size:11px;line-height:20px;color:var(--td-brand-color);text-decoration:none}
.lc-day-detail-open:hover{text-decoration:underline}
.lc-day-detail-meta{display:flex;flex:0 0 auto;align-items:center;gap:8px;margin-bottom:7px}
.lc-day-detail-time{font-size:12px;color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums;margin-bottom:10px}
.lc-day-detail-time span{margin-left:7px;color:var(--td-text-color-placeholder);font-size:11px}
.lc-day-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.lc-day-field-label{font-size:11px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-day-select{width:100%;height:30px;padding:0 8px;border:1px solid var(--td-component-stroke);border-radius:5px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);font-size:12px;outline:none;box-sizing:border-box}
.lc-day-select:focus{border-color:var(--td-brand-color)}
.lc-day-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;padding:9px 0 10px;margin-bottom:2px;border-top:1px solid var(--td-component-stroke);border-bottom:1px solid var(--td-component-stroke);font-size:11px;line-height:17px;color:var(--td-text-color-placeholder)}
.lc-day-detail-grid b{display:block;font-weight:500;color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums;word-break:break-all}
.lc-day-desc-field{flex:0 0 auto;min-height:0;margin-top:10px;margin-bottom:0}
.lc-day-desc{width:100%;min-height:104px;resize:vertical;box-sizing:border-box;padding:8px 9px;border:1px solid var(--td-component-stroke);border-radius:5px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);font-size:12px;line-height:18px;outline:none}
.lc-day-desc:focus{border-color:var(--td-brand-color)}
.lc-day-desc-foot{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}
.lc-day-detail-message{font-size:11px;color:#2ba471}
.lc-day-detail-error{font-size:11px;color:#d54941}
.lc-day-detail-error-block{padding:10px 0;font-size:12px;color:#d54941}
.lc-subtasks{flex:0 0 auto;margin-top:14px;padding-top:13px;border-top:1px solid var(--td-component-stroke)}
.lc-subtasks-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:20px}
.lc-subtasks-title{font:600 12.5px/20px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-subtasks-count{font:500 11px/18px var(--td-font-family);color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-subtask-list{display:flex;flex-direction:column;gap:1px;margin-top:5px}
.lc-subtask-row{display:flex;align-items:center;gap:8px;min-height:28px;padding:3px 5px;border-radius:5px;cursor:pointer}
.lc-subtask-row:hover{background:var(--td-bg-color-container-hover,rgba(0,0,0,.03))}
.lc-subtask-check{flex:0 0 auto;width:14px;height:14px;margin:0;accent-color:var(--td-brand-color);cursor:pointer}
.lc-subtask-title{flex:1 1 auto;min-width:0;font:400 12px/18px var(--td-font-family);color:var(--td-text-color-primary);overflow-wrap:anywhere}
.lc-subtask-title.is-done{color:var(--td-text-color-placeholder);text-decoration:line-through}
.lc-subtask-del{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--td-text-color-placeholder);opacity:.5;cursor:pointer}
.lc-subtask-del:hover{opacity:1;color:var(--td-error-color,#d54941);background:rgba(213,73,65,.08)}
.lc-subtask-del:focus-visible{opacity:1;outline:2px solid var(--td-brand-color);outline-offset:1px}
.lc-subtask-empty{padding:8px 5px 6px;font-size:11.5px;line-height:18px;color:var(--td-text-color-placeholder)}
.lc-subtask-add{display:flex;align-items:center;gap:6px;margin-top:7px}
.lc-subtask-input{flex:1 1 auto;min-width:0;height:30px;box-sizing:border-box;padding:0 9px;border:1px solid var(--td-component-stroke);border-radius:5px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:400 12px/18px var(--td-font-family);outline:none}
.lc-subtask-input::placeholder{color:var(--td-text-color-placeholder)}
.lc-subtask-input:focus{border-color:var(--td-brand-color);box-shadow:0 0 0 2px rgba(47,124,246,.12)}
.lc-subtask-input:disabled{background:var(--td-bg-color-container-hover,rgba(0,0,0,.03));cursor:not-allowed}
.lc-subtask-add-btn{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:5px;background:rgba(47,124,246,.1);color:var(--td-brand-color);cursor:pointer}
.lc-subtask-add-btn:hover:not(:disabled){background:rgba(47,124,246,.18)}
.lc-subtask-add-btn:disabled{opacity:.42;cursor:not-allowed}
.lc-subtask-error{margin-top:5px;font-size:11px;line-height:16px}
.lc-subtask-error{color:var(--td-error-color,#d54941)}
.lc-subtask-progress{display:flex;align-items:center;gap:8px;margin-top:10px}
.lc-subtask-progress-bar{position:relative;flex:1 1 auto;height:6px;overflow:hidden;border-radius:999px;background:rgba(0,0,0,.08)}
.lc-subtask-progress-fill{display:block;height:100%;border-radius:999px;background:var(--td-brand-color);transition:width .18s ease}
.lc-subtask-progress-text{flex:0 0 auto;min-width:32px;text-align:right;font:500 11px/16px var(--td-font-family);color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums}
body[data-ds-dark-theme] .lc-root .lc-subtask-row:hover{background:rgba(255,255,255,.06)}
body[data-ds-dark-theme] .lc-root .lc-subtask-progress-bar{background:rgba(255,255,255,.12)}
body[data-ds-dark-theme] .lc-root .lc-day-axis{background:#181818}
body[data-ds-dark-theme] .lc-root .lc-day-slot>span{background:#181818}
body[data-ds-dark-theme] .lc-root .lc-day-slot{border-bottom-color:rgba(255,255,255,.06)}
body[data-ds-dark-theme] .lc-root .lc-day-slot>span{background:#181818}
body[data-ds-dark-theme] .lc-root .lc-day-lane{background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 27px,rgba(255,255,255,.055) 27px,rgba(255,255,255,.055) 28px),repeating-linear-gradient(to bottom,transparent 0,transparent 55px,rgba(255,255,255,.09) 55px,rgba(255,255,255,.09) 56px);background-color:#181818}
body[data-ds-dark-theme] .lc-root .lc-day-event{background:#253549;color:#a9c7ff}
body[data-ds-dark-theme] .lc-root .lc-day-event:hover{background:#2d4262}
body[data-ds-dark-theme] .lc-root .lc-day-event-done,body[data-ds-dark-theme] .lc-root .lc-day-event-inactive{background:#2c2c2c;color:rgba(255,255,255,.42);border-left-color:rgba(255,255,255,.3)}
body[data-ds-dark-theme] .lc-root .lc-day-event-done .lc-day-event-title,body[data-ds-dark-theme] .lc-root .lc-day-event-inactive .lc-day-event-title{color:rgba(255,255,255,.42)}
body[data-ds-dark-theme] .lc-root .lc-day-detail{background:var(--td-bg-color-container)}
body[data-ds-dark-theme] .lc-root .lc-detail-priority-2,
body[data-ds-dark-theme] .lc-root .lc-task-pri-2{background:rgba(245,197,66,.16);color:#f5c542}
body[data-ds-dark-theme] .lc-root .lc-detail-priority-3,
body[data-ds-dark-theme] .lc-root .lc-task-pri-3{background:rgba(77,133,255,.18);color:#8ab4ff}

/* 顶部拖拽窗口（桌面端） */
.lc-stage{position:relative}
.lc-stage:before{content:'';position:absolute;top:0;left:0;right:0;height:10px;z-index:40;-webkit-app-region:drag;app-region:drag}
.lc-cal-head{-webkit-app-region:drag;app-region:drag;user-select:none;-webkit-user-select:none}
.lc-cal-head button,.lc-cal-head input,.lc-cal-head label,.lc-cal-head select,.lc-cal-head a{-webkit-app-region:no-drag;app-region:no-drag}
.lc-task-head{-webkit-app-region:drag;app-region:drag;user-select:none;-webkit-user-select:none}
.lc-task-head *{-webkit-app-region:drag;app-region:drag}
/* Markdown 任务详情 */
.lc-md-head{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:8px}
.lc-md-edit-btn{border:0;background:transparent;color:var(--td-text-color-placeholder);font:var(--td-font-body-small);font-size:11px;cursor:pointer;padding:0 2px}
.lc-md-edit-btn:hover{color:var(--td-brand-color)}
.lc-md-view{flex:1 1 auto;min-height:0;padding:8px 2px 4px;font:var(--td-font-body-medium);font-size:13px;line-height:1.75;color:var(--td-text-color-primary);cursor:text;outline:none;word-break:break-word}
.lc-md-view:hover{background:var(--td-bg-color-container-hover);border-radius:6px}
.lc-md-view:focus-visible{box-shadow:0 0 0 2px var(--td-brand-color-light);border-radius:6px}
.lc-md-view h1,.lc-md-view h2,.lc-md-view h3,.lc-md-view h4{color:var(--td-text-color-primary);font-weight:600;line-height:1.4;margin:14px 0 8px}
.lc-md-view h1:first-child,.lc-md-view h2:first-child,.lc-md-view h3:first-child,.lc-md-view h4:first-child{margin-top:0}
.lc-md-view h1{font-size:20px}
.lc-md-view h2{font-size:17px}
.lc-md-view h3{font-size:15px}
.lc-md-view h4{font-size:13.5px}
.lc-md-view p{margin:0 0 8px}
.lc-md-view ul,.lc-md-view ol{margin:0 0 8px;padding-left:21px}
.lc-md-view li{margin:2px 0}
.lc-md-view .lc-md-check{list-style:none;display:flex;align-items:flex-start;gap:7px;margin-left:-19px}
.lc-md-view .lc-md-check input{margin-top:4px}
.lc-md-view blockquote{margin:0 0 8px;padding:3px 10px;border-left:3px solid var(--td-brand-color);background:var(--td-bg-color-page);color:var(--td-text-color-secondary);border-radius:0 4px 4px 0}
.lc-md-view code{padding:1px 5px;border-radius:4px;background:var(--td-bg-color-page);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.lc-md-view pre{margin:0 0 10px;padding:10px 12px;border-radius:6px;background:var(--td-bg-color-page);overflow:auto;line-height:1.6}
.lc-md-view pre code{padding:0;background:transparent;font-size:12px}
.lc-md-view a{color:var(--td-brand-color);text-decoration:none}
.lc-md-view a:hover{text-decoration:underline}
.lc-md-view hr{border:0;border-top:1px solid var(--td-component-stroke);margin:12px 0}
.lc-md-view del{color:var(--td-text-color-placeholder)}
.lc-md-empty{color:var(--td-text-color-placeholder);font-size:12px}
.lc-md-editor{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;gap:6px}
.lc-md-input{width:100%;flex:1 1 auto;min-height:140px;resize:none;box-sizing:border-box;padding:10px 11px;border:1px solid var(--td-component-stroke);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);font-size:12.5px;line-height:1.7;outline:none}
body[data-ds-dark-theme] .lc-root .lc-md-view blockquote,
body[data-ds-dark-theme] .lc-root .lc-md-view code,
body[data-ds-dark-theme] .lc-root .lc-md-view pre{background:#262626}
.lc-tasks .lc-day-detail-title{font-size:19px;line-height:1.45;font-weight:600}
.lc-tasks .lc-md-view{font-size:13.5px}
.lc-tasks .lc-md-view h2{font-size:18px}
.lc-detail-mask{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.42)}
.lc-modal.lc-detail-modal{width:min(520px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:hidden;border-radius:10px}
.lc-detail-modal .lc-day-detail{height:auto;max-height:calc(100vh - 48px);padding:20px 22px;border-left:0;border-radius:10px;overflow:auto}
.lc-detail-modal .lc-day-detail-head{margin-bottom:10px}
.lc-detail-modal .lc-day-detail-title{font-size:18px;line-height:26px}
.lc-modal-dialog{position:fixed;inset:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;margin:0;padding:24px;border:0;background:transparent;display:flex;align-items:center;justify-content:center;box-sizing:border-box;overflow:auto}
.lc-modal-dialog::backdrop{background:rgba(0,0,0,.4)}
.lc-modal{width:520px;max-width:100%;border-radius:8px;background:var(--td-bg-color-container);box-shadow:0 12px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;max-height:calc(100vh - 48px);overflow:visible}
.lc-modal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:20px 24px 0}
.lc-modal-title{font-size:16px;font-weight:600;color:var(--td-text-color-primary);line-height:24px}
.lc-modal-close{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--td-text-color-secondary);cursor:pointer}
.lc-modal-close:hover{background:var(--td-bg-color-container-hover);color:var(--td-text-color-primary)}
.lc-modal-body{padding:16px 24px 4px;display:flex;flex-direction:column;gap:16px;overflow:visible}
.lc-modal-target{margin:0 0 12px;padding:7px 10px;border-radius:8px;background:var(--td-brand-color-light);color:var(--td-brand-color);font:400 12px/18px var(--td-font-family)}
.lc-modal.lc-modal-batch{width:760px}
.lc-task-modal-tabs{display:flex;gap:4px;padding:10px 24px 0;margin-top:8px;border-bottom:1px solid var(--td-component-stroke)}
.lc-task-modal-tab{position:relative;height:34px;padding:0 12px;border:0;background:transparent;color:var(--td-text-color-secondary);cursor:pointer;font:var(--td-font-body-medium);font-size:13px;white-space:nowrap}
.lc-task-modal-tab:hover{color:var(--td-text-color-primary)}
.lc-task-modal-tab-active{color:var(--td-brand-color);font-weight:600}
.lc-task-modal-tab-active:after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--td-brand-color)}
.lc-modal-body-batch{padding-top:14px;gap:12px;max-height:calc(100vh - 238px);overflow:auto}
.lc-batch-textarea{min-height:138px!important;resize:vertical}
.lc-batch-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:-4px}
.lc-batch-count{font-size:12px;color:var(--td-text-color-secondary)}
.lc-batch-identify{height:30px;padding:0 18px}
.lc-batch-hint{font-size:12px;line-height:18px;color:var(--td-text-color-placeholder);margin-top:-4px}
.lc-batch-result{display:flex;flex-direction:column;gap:8px}
.lc-batch-result-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:2px}
.lc-batch-result-title{font-size:13px;font-weight:600;color:var(--td-text-color-primary)}
.lc-batch-result-sub{font-size:12px;color:var(--td-text-color-secondary)}
.lc-batch-list{display:flex;flex-direction:column;gap:8px}
.lc-batch-row{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--td-component-stroke);border-radius:8px;background:var(--td-bg-color-container)}
.lc-batch-row-head{display:flex;align-items:center;gap:8px;min-width:0}
.lc-batch-index{font-size:11px;color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums;flex:0 0 auto}
.lc-batch-title{flex:1;min-width:0;font-size:13px;font-weight:500;color:var(--td-text-color-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-batch-match{flex:0 0 auto;padding:1px 6px;border-radius:4px;background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-secondary);font-size:11px;line-height:16px}
.lc-batch-match-hit{background:var(--td-success-color-light,#e8f8f0);color:var(--td-success-color,#2ba471)}
.lc-batch-remove{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:4px;background:transparent;color:var(--td-text-color-placeholder);cursor:pointer;flex:0 0 auto}
.lc-batch-remove:hover{background:var(--td-bg-color-container-hover);color:var(--td-error-color,#d54941)}
.lc-batch-controls{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) 132px;gap:8px}
.lc-batch-control{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:11px;color:var(--td-text-color-secondary)}
.lc-batch-control .lc-input{height:30px;min-height:30px;padding:0 8px;font-size:12px;line-height:28px}
.lc-batch-control select.lc-input{appearance:auto;padding-right:24px}
.lc-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:20px 24px 24px}
.lc-modal .lc-field{display:flex;flex-direction:column;align-items:stretch;gap:6px;text-align:left}
.lc-modal .lc-field-label{display:flex;align-items:center;gap:2px;font-size:13px;line-height:20px;color:var(--td-text-color-primary);white-space:nowrap}
.lc-modal .lc-field-required{color:var(--td-error-color,#d54941);font-weight:600;line-height:18px}
.lc-modal .lc-field-label-text{line-height:18px}
.lc-modal .lc-input,.lc-modal .lc-textarea{width:100%;box-sizing:border-box;min-height:0;border:1px solid var(--td-border-level-2-color,#dcdcdc);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);font-size:13px;transition:border-color .15s,box-shadow .15s}
.lc-modal .lc-input{height:32px;padding:0 10px;line-height:30px}
.lc-modal .lc-textarea{height:auto;min-height:76px;padding:8px 10px;line-height:20px;resize:vertical;font-family:inherit}
.lc-modal .lc-input:hover,.lc-modal .lc-textarea:hover{border-color:var(--td-brand-color)}
.lc-modal .lc-input:focus,.lc-modal .lc-textarea:focus{outline:none;border:1px solid var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-focus,rgba(0,82,217,.2))}
.lc-modal .lc-input::placeholder,.lc-modal .lc-textarea::placeholder{color:var(--td-text-color-placeholder)}
.lc-select-field{position:relative}
.lc-select-trigger{width:100%;height:32px;padding:0 10px;box-sizing:border-box;display:flex;align-items:center;gap:8px;border:1px solid var(--td-border-level-2-color,#dcdcdc);border-radius:6px;background:var(--td-bg-color-container);cursor:pointer;font:var(--td-font-body-medium);font-size:13px;color:var(--td-text-color-primary);text-align:left;transition:border-color .15s,box-shadow .15s}
.lc-select-trigger:hover{border-color:var(--td-brand-color)}
.lc-select-field-open .lc-select-trigger{border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-focus,rgba(0,82,217,.2))}
.lc-select-trigger-disabled{opacity:.6;cursor:default;background:var(--td-bg-color-container-hover)}
.lc-select-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-select-placeholder{flex:1;min-width:0;color:var(--td-text-color-placeholder);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-select-arrow{display:inline-flex;color:var(--td-text-color-placeholder);flex:0 0 auto;transition:transform .15s}
.lc-select-field-open .lc-select-arrow{transform:rotate(180deg)}
.lc-select-popup{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:20;max-height:240px;overflow:auto;padding:4px 0;border:1px solid var(--td-component-stroke);border-radius:8px;background:var(--td-bg-color-container);box-shadow:0 6px 24px rgba(0,0,0,.14);scrollbar-width:thin}
.lc-select-search-wrap{padding:6px;border-bottom:1px solid var(--td-component-stroke);position:sticky;top:0;background:var(--td-bg-color-container);z-index:1}
.lc-select-search{width:100%;height:28px;padding:0 8px;box-sizing:border-box;border:1px solid var(--td-border-level-2-color,#dcdcdc);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);font-size:12px;outline:none}
.lc-select-search:focus{border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-focus,rgba(0,82,217,.2))}
.lc-select-search::placeholder{color:var(--td-text-color-placeholder)}
.lc-select-group{padding:6px 12px 4px;font-size:12px;color:var(--td-text-color-placeholder)}
.lc-select-option{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border:0;background:transparent;cursor:pointer;font-size:13px;color:var(--td-text-color-primary);text-align:left}
.lc-select-option:hover{background:var(--td-bg-color-container-hover)}
.lc-select-option-active{background:var(--td-brand-color-light,#f2f3ff);color:var(--td-text-color-brand)}
.lc-select-option-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-select-empty{padding:10px 12px;font-size:12px;color:var(--td-text-color-placeholder)}
.lc-option-status{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;font-size:12px;color:var(--td-text-color-secondary)}
.lc-status-dot{width:6px;height:6px;border-radius:50%;display:inline-block}
.lc-status-dot-doing{background:#2ba471}
.lc-status-dot-wait{background:#b9b9b9}
.lc-modal .lc-field-error{padding:8px 10px;border-radius:6px;background:var(--td-error-color-1,#fff0ef);color:var(--td-error-color,#d54941);font-size:12px}
.lc-btn{height:32px;padding:0 18px;border-radius:6px;border:1px solid transparent;cursor:pointer;font-size:13px}
.lc-btn-ghost{border-color:var(--td-border-level-2-color,#dcdcdc);background:transparent;color:var(--td-text-color-secondary)}
.lc-btn-ghost:hover{color:var(--td-text-color-primary);border-color:var(--td-brand-color)}
.lc-btn-primary{background:var(--td-brand-color);color:#fff}
.lc-btn-primary:hover{background:var(--td-brand-color-hover)}
.lc-btn-primary:disabled{opacity:.6;cursor:default}
.lc-only-mine-switch{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;padding:2px 4px;border-radius:6px;cursor:pointer;user-select:none;-webkit-app-region:no-drag}
.lc-only-mine-switch:hover{background:var(--td-bg-color-container-hover)}
.lc-only-mine-label{font-size:12px;line-height:18px;color:var(--td-text-color-secondary);white-space:nowrap}
.lc-cell-me{color:var(--td-error-color);font-weight:500}
@container (max-width:430px){.lc-main-head .lc-current{display:none}}
.lc-current{flex:0 1 auto;min-width:120px;max-width:280px;font:var(--td-font-body-small);color:var(--td-text-color-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.lc-table-wrap{display:flex;flex-direction:column;flex:1 1 0;overflow:auto;min-height:0;min-width:0;background:#fff}
.lc-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;margin:auto;padding:24px;text-align:center;font:var(--td-font-body-medium)}
.lc-empty-image{display:flex;align-items:center;justify-content:center;color:var(--lc-icon-muted)}
.lc-empty-title{margin-top:8px;font:var(--td-font-body-medium);color:var(--td-text-color-secondary)}
.lc-empty-description{margin-top:4px;font:var(--td-font-body-small);color:var(--td-text-color-placeholder)}
.lc-table{width:100%;min-width:0;border-collapse:separate;border-spacing:0;table-layout:fixed;font:var(--td-font-body-medium)}
.lc-table th{user-select:none}
.lc-table th.lc-col-dragging{opacity:.45}
.lc-table th.lc-col-drop-before:before,.lc-table th.lc-col-drop-after:before{content:'';position:absolute;top:0;bottom:0;width:2px;background:var(--td-brand-color);z-index:4;pointer-events:none}
.lc-table th.lc-col-drop-before:before{left:0}
.lc-table th.lc-col-drop-after:before{right:0}
.lc-col-resize{position:absolute;top:0;right:0;bottom:0;width:6px;z-index:3;cursor:col-resize;user-select:none;touch-action:none}
.lc-col-resize:after{content:'';position:absolute;right:2px;top:7px;bottom:7px;width:1px;border-radius:1px;background:transparent;transition:background-color .1s linear}
.lc-table th:hover .lc-col-resize:after{background:var(--td-border-level-2-color)}
.lc-table th .lc-col-resize:hover:after,.lc-table th .lc-col-resize.lc-resizing:after{background:var(--td-brand-color);width:2px}
.lc-table.lc-cols-fixed{min-width:100%}
.lc-th-btn{display:flex;align-items:center;gap:2px;min-width:0;max-width:100%;margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;line-height:inherit;white-space:nowrap;text-align:left;cursor:pointer;border-radius:var(--lc-radius)}
.lc-th-btn:hover{color:var(--td-text-color-primary)}
.lc-th-btn:focus-visible{outline:2px solid var(--td-brand-color-focus);outline-offset:1px}
.lc-th-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-table th.lc-th-sorted{color:var(--td-text-color-brand)}
.lc-table th.lc-th-sorted .lc-th-btn:hover{color:var(--td-brand-color)}
.lc-sort{display:inline-flex;align-items:center;margin-left:4px;color:var(--lc-icon-brand)}
.lc-table th.lc-col-id{width:10%}.lc-table th.lc-col-title{width:30%}.lc-table th.lc-col-module{width:14%}.lc-table th.lc-col-priority{width:12%}.lc-table th.lc-col-assignee{width:12%}.lc-table th.lc-col-state{width:22%}
.lc-table.lc-table-story th.lc-col-id{width:8%}.lc-table.lc-table-story th.lc-col-title{width:26%}.lc-table.lc-table-story th.lc-col-module{width:12%}.lc-table.lc-table-story th.lc-col-priority{width:9%}.lc-table.lc-table-story th.lc-col-assignee{width:9%}.lc-table.lc-table-story th.lc-col-storystate{width:9%}.lc-table.lc-table-story th.lc-col-state{width:27%}
.lc-table th.lc-col-id,.lc-table td.lc-col-id{min-width:54px}
.lc-table th.lc-col-priority,.lc-table td.lc-col-priority{min-width:56px}
.lc-table th.lc-col-assignee,.lc-table td.lc-col-assignee{min-width:86px}
.lc-table th.lc-col-state,.lc-table td.lc-col-state{min-width:86px}
.lc-table th.lc-col-storystate,.lc-table td.lc-col-storystate{min-width:86px}
.lc-table th.lc-col-bugstatus,.lc-table td.lc-col-bugstatus{min-width:86px;width:86px;white-space:nowrap}
.lc-table th.lc-col-deadline,.lc-table td.lc-col-deadline{min-width:96px}
.lc-table th.lc-col-date,.lc-table td.lc-col-date{min-width:96px}
.lc-table th.lc-col-owner,.lc-table td.lc-col-owner{min-width:96px}
.lc-table.lc-table-task th.lc-col-id{width:8%}.lc-table.lc-table-task th.lc-col-title{width:26%}.lc-table.lc-table-task th.lc-col-module{width:13%}.lc-table.lc-table-task th.lc-col-priority{width:9%}.lc-table.lc-table-task th.lc-col-state{width:16%}.lc-table.lc-table-task th.lc-col-assignee{width:14%}.lc-table.lc-table-task th.lc-col-deadline{width:14%}
.lc-table.lc-table-testtask th.lc-col-id{width:9%}.lc-table.lc-table-testtask th.lc-col-title{width:32%}.lc-table.lc-table-testtask th.lc-col-state{width:12%}.lc-table.lc-table-testtask th.lc-col-owner{width:17%}.lc-table.lc-table-testtask th.lc-col-date{width:15%}
.lc-table.lc-table-report th.lc-col-id{width:9%}.lc-table.lc-table-report th.lc-col-title{width:45%}.lc-table.lc-table-report th.lc-col-testtask{width:30%}.lc-table.lc-table-report th.lc-col-date{width:16%}
@container (max-width: 560px){
.lc-table.lc-table-task th.lc-col-module,.lc-table.lc-table-task td.lc-col-module{display:none}
.lc-table.lc-table-task th.lc-col-priority,.lc-table.lc-table-task td.lc-col-priority{width:14%}
.lc-table.lc-table-testtask th.lc-col-date:nth-of-type(5),.lc-table.lc-table-testtask td.lc-col-date:nth-of-type(5),.lc-table.lc-table-testtask th.lc-col-date:nth-of-type(6),.lc-table.lc-table-testtask td.lc-col-date:nth-of-type(6){display:none}
.lc-table.lc-table-report th.lc-col-testtask,.lc-table.lc-table-report td.lc-col-testtask{display:none}
}
@container (max-width: 480px){
.lc-table.lc-table-task th.lc-col-priority,.lc-table.lc-table-task td.lc-col-priority{display:none}
.lc-table.lc-table-testtask th.lc-col-owner,.lc-table.lc-table-testtask td.lc-col-owner{display:none}
}
.lc-popup-date{display:flex;flex-direction:column;gap:10px;padding:12px}
.lc-popup-date-input{height:32px;padding:0 10px;border:1px solid var(--td-border-level-2-color);border-radius:var(--td-radius-default,6px);background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);box-sizing:border-box;width:100%}
.lc-popup-date-actions{display:flex;justify-content:flex-end;gap:8px}
.lc-popup-date-btn{height:28px;padding:0 12px;border:1px solid var(--td-border-level-2-color);border-radius:var(--td-radius-round,999px);background:transparent;color:var(--td-text-color-secondary);cursor:pointer;font-size:12px}
.lc-popup-date-primary{border-color:var(--td-brand-color);background:var(--td-brand-color);color:#fff}
@container (max-width: 620px){
.lc-table.lc-table-story:not(.lc-cols-fixed) th.lc-col-module,.lc-table.lc-table-story:not(.lc-cols-fixed) td.lc-col-module{display:none}
.lc-table.lc-table-story th.lc-col-id{width:10%}.lc-table.lc-table-story th.lc-col-title{width:30%}.lc-table.lc-table-story th.lc-col-priority{width:12%}.lc-table.lc-table-story th.lc-col-assignee{width:14%}.lc-table.lc-table-story th.lc-col-storystate{width:12%}.lc-table.lc-table-story th.lc-col-state{width:22%}
}
@container (max-width: 480px){
.lc-table.lc-table-story:not(.lc-cols-fixed) th.lc-col-assignee,.lc-table.lc-table-story:not(.lc-cols-fixed) td.lc-col-assignee{display:none}
.lc-table.lc-table-story th.lc-col-id{width:12%}.lc-table.lc-table-story th.lc-col-title{width:36%}.lc-table.lc-table-story th.lc-col-priority{width:14%}.lc-table.lc-table-story th.lc-col-storystate{width:14%}.lc-table.lc-table-story th.lc-col-state{width:24%}
}
.lc-table-wrap{container-type:inline-size}
@container (max-width:440px){
.lc-table:not(.lc-cols-fixed) th.lc-col-id{width:15%}.lc-table:not(.lc-cols-fixed) th.lc-col-title{width:45%}.lc-table:not(.lc-cols-fixed) th.lc-col-priority{width:17%}.lc-table:not(.lc-cols-fixed) th.lc-col-state{width:23%}
.lc-table:not(.lc-cols-fixed) .lc-col-module,.lc-table:not(.lc-cols-fixed) .lc-col-assignee{display:none}
}
@container (max-width:340px){
.lc-table:not(.lc-cols-fixed) th.lc-col-id{width:18%}.lc-table:not(.lc-cols-fixed) th.lc-col-title{width:54%}.lc-table:not(.lc-cols-fixed) th.lc-col-state{width:28%}
.lc-table:not(.lc-cols-fixed) .lc-col-priority{display:none}
}
.lc-table th{position:sticky;top:0;z-index:1;height:40px;padding:0 8px;text-align:left;font-size:12px;line-height:20px;font-weight:500;color:var(--td-text-color-placeholder);background:#fff;border-bottom:1px solid var(--td-component-border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-table td{height:44px;padding:0 8px;border-bottom:1px solid rgba(15,23,42,.06);color:var(--td-text-color-primary);vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-ds-dark-theme] .lc-root .lc-table td{border-bottom-color:rgba(255,255,255,.08)}
.lc-table tbody tr{cursor:grab;transition:background-color .2s linear}
.lc-table tbody tr:hover{background:var(--td-bg-color-container-hover)}
.lc-mono{font-family:var(--td-font-family-code);font-size:12px;color:var(--td-text-color-placeholder)}
.lc-title-cell a{color:var(--td-text-color-primary);text-decoration:none}
.lc-title-cell a:hover{color:var(--td-text-color-brand);text-decoration:underline}
.lc-cell-action{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 6px;margin:-2px -6px;border:0;background:transparent;border-radius:var(--lc-radius);cursor:pointer;font:inherit;color:inherit;text-align:left;overflow:hidden}
.lc-cell-action:hover{background:var(--td-bg-color-container-hover)}
.lc-cell-action.lc-overdue-date{background:#e34d59;color:#fff;font-weight:600;padding:2px 8px;margin:0;border-radius:4px}
.lc-cell-action.lc-overdue-date:hover{background:#c93b47;color:#fff}
.lc-overdue-date .lc-cell-text{color:#fff}
.lc-cell-action:focus-visible{outline:2px solid var(--td-brand-color-focus);outline-offset:0}
.lc-cell-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-cell-caret{display:inline-flex;flex:0 0 auto;color:var(--lc-icon-muted);opacity:0;transition:opacity .1s linear}
.lc-cell-action:hover .lc-cell-caret,.lc-cell-action:focus-visible .lc-cell-caret{opacity:1}
.lc-popup-layer{position:fixed;inset:0;z-index:60}
.lc-popup{position:fixed;z-index:61;box-sizing:border-box;max-height:360px;overflow:auto;padding:4px;background:var(--td-bg-color-container);border:1px solid var(--td-component-border);border-radius:var(--td-radius-medium);box-shadow:var(--td-shadow-2);display:flex;flex-direction:column;gap:2px}
.lc-popup-head{padding:4px 8px 6px;font:var(--td-font-body-small);color:var(--td-text-color-secondary);border-bottom:1px solid var(--td-component-stroke);margin-bottom:2px}
.lc-cal-status-task{padding:6px 8px 6px;font-size:12px;line-height:16px;color:var(--td-text-color-placeholder);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-cal-status-error{padding:2px 8px 6px;font-size:11px;line-height:16px;color:var(--td-error-color,#e34d59)}
.lc-cal-status-note{padding:2px 8px 6px;font-size:11px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-cal-status-pop .lc-popup-list{gap:1px}
.lc-popup-list{display:flex;flex-direction:column;gap:2px}
.lc-popup-item{display:flex;align-items:center;width:100%;box-sizing:border-box;padding:6px 8px;border:0;background:transparent;border-radius:var(--td-radius-default);cursor:pointer;font:var(--td-font-body-medium);color:var(--td-text-color-primary);text-align:left}
.lc-popup-item-icon{display:inline-flex;align-items:center;justify-content:center;margin-right:8px;flex:0 0 auto}
.lc-popup-item-danger{color:var(--td-error-color)}
.lc-popup-item-danger:hover:not(:disabled){background:rgba(213,48,49,.08);color:var(--td-error-color)}
.lc-popup-item-danger .lc-popup-item-icon{color:var(--td-error-color)}
.lc-popup-item:hover:not(:disabled){background:var(--td-bg-color-container-hover)}
.lc-popup-item-active{background:var(--td-brand-color-light);color:var(--td-text-color-brand);font-weight:500}
.lc-popup-item:disabled{opacity:.5;cursor:progress}
.lc-popup-item-disabled:disabled{cursor:not-allowed}
.lc-popup-loading{padding:10px 8px;font:var(--td-font-body-small);color:var(--td-text-color-placeholder)}
.lc-toast.lc-toast-success{background:var(--td-success-color-light);border-color:var(--td-success-color);color:var(--td-success-color)}
.lc-toast{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:70;max-width:min(520px,82vw);padding:8px 12px;border-radius:var(--td-radius-medium);background:var(--td-error-color-light);border:1px solid var(--td-error-color);color:var(--td-error-color);font:var(--td-font-body-small);box-shadow:var(--td-shadow-2)}
.lc-tag{display:inline-flex;align-items:center;height:24px;max-width:100%;box-sizing:border-box;padding:0 8px;border:1px solid transparent;border-radius:20px;font-weight:400;font-size:12px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-tag-default{background:var(--td-bg-color-secondarycontainer);border-color:var(--td-component-border);color:var(--td-text-color-primary)}
.lc-tag-primary{background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-tag-success{background:var(--td-success-color-light);color:var(--td-success-color)}
.lc-tag-warning{background:var(--td-warning-color-light);color:var(--td-warning-color)}
.lc-tag-error{background:var(--td-error-color-light);color:var(--td-error-color)}
.lc-detail-pill{position:relative;gap:3px;padding:0 6px 0 9px;cursor:pointer;user-select:none}
.lc-detail-pill>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.lc-detail-pill svg{flex:0 0 auto;opacity:.7}
.lc-detail-pill:hover{filter:brightness(.97)}
.lc-detail-pill:focus-within{box-shadow:0 0 0 2px var(--td-brand-color-focus)}
.lc-detail-pill-busy{opacity:.6}
.lc-detail-pill-select{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer;appearance:none;font-size:16px}
.lc-detail-pill-select:disabled{cursor:default}
.lc-detail-priority-1{background:var(--td-error-color-light);color:var(--td-error-color)}
.lc-detail-priority-2{background:#fff3cd;color:#9a6700}
.lc-detail-priority-3{background:#e7f0ff;color:#2563eb}
.lc-chat{flex:1 1 0;overflow:auto;min-height:0;min-width:0;padding:16px;display:flex;flex-direction:column;gap:16px;background:var(--td-bg-color-container)}
.lc-chat-empty{margin:auto;text-align:center;color:var(--td-text-color-secondary);max-width:300px}
.lc-chat-empty-title{font:var(--td-font-title-small);color:var(--td-text-color-primary);margin-bottom:8px}
.lc-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:16px;max-width:320px}
.lc-suggest-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:1px solid var(--td-border-level-2-color);border-radius:10px;background:var(--td-bg-color-specialcomponent);color:var(--td-text-color-primary);cursor:pointer;font:var(--td-font-body-medium);transition:color .2s,border-color .2s,background-color .2s}
.lc-suggest-btn:hover{color:var(--td-brand-color-hover);border-color:var(--td-brand-color-hover);background:var(--td-bg-color-container-hover)}
.lc-suggest-btn:focus-visible{outline:2px solid var(--td-brand-color-focus);outline-offset:0}
.lc-msg{display:flex;flex-direction:column;gap:12px;max-width:100%;min-width:0}
.lc-msg-user{align-items:flex-end}
.lc-msg-user .lc-bubble{background:var(--dsw-specific-bubble,var(--td-brand-color-light));color:var(--td-text-color-primary);border-radius:20px;padding:12px 16px;max-width:85%;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.lc-msg-meta{display:flex;align-items:center;gap:10px;padding:0 6px;min-height:24px;font-size:12px;line-height:18px;color:var(--td-text-color-placeholder)}
.lc-msg-time{white-space:nowrap}
.lc-msg-action{width:24px;height:24px;color:var(--td-text-color-placeholder)}
.lc-msg-action:hover:not(:disabled){color:var(--td-text-color-primary)}
.lc-msg-copied,.lc-msg-copied:hover:not(:disabled){color:var(--td-success-color)}
.lc-msg-assistant .lc-bubble{color:var(--td-text-color-primary);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.lc-msg-assistant .lc-bubble.lc-markdown{white-space:normal}
.lc-markdown>:first-child{margin-top:0}
.lc-markdown>:last-child{margin-bottom:0}
.lc-md-p{margin:0 0 8px;line-height:22px}
.lc-md-h{margin:12px 0 6px;line-height:1.4;font-weight:600;color:var(--td-text-color-primary)}
.lc-md-h1{font-size:18px}.lc-md-h2{font-size:16px}.lc-md-h3{font-size:15px}.lc-md-h4,.lc-md-h5,.lc-md-h6{font-size:14px}
.lc-md-list{margin:0 0 8px;padding-left:20px}
.lc-md-li{margin:2px 0;line-height:22px}
.lc-md-code{padding:1px 5px;border-radius:var(--td-radius-small);background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-primary);font-family:var(--td-font-family-code);font-size:12px}
.lc-md-pre{margin:0 0 8px;padding:10px 12px;border-radius:var(--td-radius-medium);background:var(--td-bg-color-secondarycontainer);border:1px solid var(--td-component-stroke);overflow:auto;max-height:360px}
.lc-md-pre code{font-family:var(--td-font-family-code);font-size:12px;line-height:20px;white-space:pre}
.lc-md-quote{margin:0 0 8px;padding:2px 0 2px 10px;border-left:3px solid var(--td-border-level-2-color);color:var(--td-text-color-secondary)}
.lc-md-hr{border:0;height:1px;background:var(--td-component-stroke);margin:10px 0}
.lc-md-link{color:var(--td-text-color-brand);text-decoration:none}
.lc-md-link:hover{text-decoration:underline}
.lc-md-image{max-width:100%;border-radius:var(--td-radius-medium);margin:4px 0}
.lc-md-table-wrap{margin:0 0 8px;overflow:auto;border:1px solid var(--td-component-border);border-radius:var(--td-radius-medium)}
.lc-md-table{width:100%;border-collapse:collapse;font:var(--td-font-body-small)}
.lc-md-table th,.lc-md-table td{padding:6px 10px;border-bottom:1px solid var(--td-component-stroke);text-align:left;vertical-align:top}
.lc-md-table th{background:var(--td-bg-color-secondarycontainer);font-weight:600;color:var(--td-text-color-secondary)}
.lc-md-table tr:last-child td{border-bottom:0}
.lc-typing{font:var(--td-font-body-small);color:var(--td-text-color-placeholder);padding:2px 4px}
.lc-card{border:1px solid var(--lc-card-border);background:var(--lc-card-bg);border-radius:15px;padding:16px;display:flex;flex-direction:column;gap:8px}
.lc-card-primary{border-color:var(--lc-card-primary-border);background:var(--lc-card-primary-bg)}
.lc-edit-hint{margin-left:auto;font:var(--td-font-body-small);color:var(--td-text-color-placeholder)}
.lc-edit-field{display:flex;flex-direction:column;gap:2px;min-width:0}
.lc-edit-label{font:var(--td-font-body-small);color:var(--td-text-color-secondary)}
.lc-edit-title{width:100%;box-sizing:border-box;margin:0;padding:4px 6px;border:1px solid transparent;border-radius:var(--lc-radius);background:transparent;color:var(--td-text-color-primary);font:var(--td-font-title-small);outline:none;transition:background-color .12s linear,border-color .12s linear,box-shadow .12s linear}
.lc-edit-textarea{display:block;width:100%;box-sizing:border-box;min-height:30px;height:auto;padding:4px 6px;border:1px solid transparent;border-radius:var(--lc-radius);background:transparent;color:var(--td-text-color-primary);font:var(--td-font-body-medium);line-height:22px;resize:none;overflow:hidden;outline:none;transition:background-color .12s linear,border-color .12s linear,box-shadow .12s linear}
.lc-edit-title::placeholder,.lc-edit-textarea::placeholder{color:var(--td-text-color-placeholder)}
.lc-edit-title:hover,.lc-edit-textarea:hover{background:var(--td-bg-color-container-hover)}
.lc-edit-title:focus,.lc-edit-textarea:focus{background:var(--td-bg-color-specialcomponent);border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-focus)}
.lc-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lc-card-tag{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:var(--lc-radius);background:var(--td-bg-color-container);color:var(--td-text-color-secondary);font-size:12px;line-height:20px}
.lc-card-tag-warn{background:var(--td-warning-color-light);color:var(--td-warning-color)}
.lc-api-meta{display:flex;align-items:center;gap:8px;font:var(--td-font-body-small);color:var(--td-text-color-secondary);min-width:0}
.lc-api-meta code{font-family:var(--td-font-family-code);font-size:12px;line-height:18px;padding:2px 6px;border-radius:4px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.lc-api-list{display:flex;flex-direction:column;gap:4px}
.lc-api-item{display:flex;align-items:center;gap:8px;min-width:0;font:var(--td-font-body-medium)}
.lc-api-id{flex:0 0 auto;font-family:var(--td-font-family-code);font-size:12px;color:var(--td-text-color-placeholder)}
.lc-api-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-api-extra{flex:0 0 auto;font-size:12px;color:var(--td-text-color-secondary)}
.lc-api-detail{margin:0;padding:8px 10px;border-radius:6px;background:var(--td-bg-color-container);font-family:var(--td-font-family-code);font-size:11px;line-height:17px;overflow:auto;max-height:220px}
.lc-api-path{margin-top:2px;font-family:var(--td-font-family-code);font-size:11px;color:var(--td-text-color-placeholder);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-doc-error{color:var(--td-error-color)}
.lc-card-title{font:var(--td-font-title-small);color:var(--td-text-color-primary)}
.lc-card-body{white-space:pre-wrap;word-break:break-word;color:var(--td-text-color-primary);font:var(--td-font-body-medium)}
.lc-card-sub{font:var(--td-font-body-small);color:var(--td-text-color-secondary);white-space:pre-wrap;word-break:break-word}
.lc-card-sub b{color:var(--td-text-color-primary);font-weight:600;display:block;margin-bottom:2px}
.lc-card-meta{display:flex;gap:16px;font:var(--td-font-body-small);color:var(--td-text-color-secondary);flex-wrap:wrap}
.lc-choices{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;min-width:0}
.lc-choice{display:inline-flex;align-items:center;justify-content:flex-start;height:auto;min-height:var(--td-comp-size-m);max-width:100%;padding:5px 15px;border:1px solid var(--td-border-level-2-color);border-radius:20px;background:var(--td-bg-color-specialcomponent);color:var(--td-text-color-primary);cursor:pointer;font:var(--td-font-body-medium);line-height:22px;white-space:normal;text-align:left;word-break:break-word;overflow-wrap:anywhere;transition:color .2s,border-color .2s,background-color .2s}
.lc-choice:hover{border-color:var(--td-brand-color-hover);color:var(--td-brand-color-hover)}
.lc-choice-primary{background:var(--td-brand-color);border-color:var(--td-brand-color);color:var(--td-text-color-anti)}
.lc-choice-primary:hover{background:var(--td-brand-color-hover);border-color:var(--td-brand-color-hover);color:var(--td-text-color-anti)}
.lc-result{background:var(--td-success-color-light);border:1px solid var(--td-success-color);border-radius:var(--td-radius-medium);padding:12px 16px;display:flex;flex-direction:column;gap:8px}
.lc-result-fail{background:var(--td-error-color-light);border-color:var(--td-error-color)}
.lc-result-title{font:var(--td-font-title-small);color:var(--td-success-color)}
.lc-result-sub{font:var(--td-font-body-medium);color:var(--td-text-color-primary);word-break:break-word}
.lc-result-fail .lc-result-title{color:var(--td-error-color)}
.lc-result-link{color:var(--td-text-color-brand);font:var(--td-font-body-small);text-decoration:none}
.lc-result-link:hover{text-decoration:underline}
.lc-case{border-top:1px solid var(--td-component-stroke);padding-top:12px;display:flex;flex-direction:column;gap:4px}
.lc-case-edit-step{display:grid;grid-template-columns:64px minmax(0,1fr);gap:6px 8px;align-items:start;padding:4px 0}
.lc-case-edit-step .lc-edit-textarea{grid-column:2}
.lc-case-title{font:var(--td-font-title-small)}
.lc-case-dir{display:inline-flex;align-items:center;height:20px;margin-left:8px;padding:0 6px;border-radius:var(--lc-radius);background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-secondary);font-size:12px;line-height:18px;font-weight:400}
.lc-case-row{font:var(--td-font-body-small);color:var(--td-text-color-primary)}
.lc-case-expect{color:var(--td-text-color-secondary)}
.lc-muted{color:var(--td-text-color-secondary)}
.lc-confirm{display:flex;flex-direction:column;gap:12px}
.lc-field{display:flex;align-items:center;gap:12px}
.lc-field-label{width:64px;flex:0 0 auto;font:var(--td-font-body-small);color:var(--td-text-color-secondary)}
.lc-field-value{font:var(--td-font-body-small);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-select{flex:1;min-width:0;height:var(--td-comp-size-m);padding:0 28px 0 var(--td-comp-paddingLR-s);background:var(--td-bg-color-specialcomponent);color:var(--td-text-color-primary);border:1px solid var(--td-border-level-2-color);border-radius:var(--td-radius-default);font:var(--td-font-body-medium);cursor:pointer;appearance:none;-webkit-appearance:none;text-overflow:ellipsis}
.lc-select:hover{border-color:var(--td-brand-color)}
.lc-select:focus,.lc-select:focus-visible{outline:none;border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-focus)}
.lc-confirm-btn{align-self:flex-end}
.lc-composer{position:relative;padding:8px 16px 16px;display:flex;flex-direction:column;gap:8px;background:var(--td-bg-color-container);min-width:0;flex:0 0 auto}
.lc-composer-card{position:relative;display:flex;flex-direction:column;width:100%;box-sizing:border-box;border-radius:var(--dsw-radius-panel,28px);background:var(--dsw-specific-input-major,var(--td-bg-color-container));--dsw-elevation-stroke-color:var(--dsw-alias-border-l2,#0000001a);box-shadow:var(--dsw-elevation-soft,0 0 0 .5px var(--dsw-alias-border-l2,#0000001a),0 4px 16px 0 #00000008,0 0 24px 0 #00000008);overflow:hidden;transition:box-shadow .15s ease}
.lc-composer.lc-drop-active .lc-composer-card{outline:2px dashed var(--td-brand-color);outline-offset:2px}
.lc-image-chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 4px 8px}
.lc-image-chip{position:relative;width:56px;height:56px;border-radius:8px;overflow:hidden;border:1px solid var(--td-component-stroke);background:var(--td-bg-color-container-hover)}
.lc-image-chip img{width:100%;height:100%;object-fit:cover;display:block}
.lc-image-chip-x{position:absolute;top:2px;right:2px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer}
.lc-image-chip-x:hover{background:rgba(0,0,0,.75)}
.lc-msg-image-names{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;margin-top:6px}
.lc-msg-image-name{font-size:12px;line-height:18px;padding:2px 8px;border-radius:10px;background:var(--td-bg-color-container-hover);color:var(--td-text-color-secondary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-chips{display:flex;gap:8px;flex-wrap:wrap}
.lc-chip{display:inline-flex;align-items:center;gap:4px;height:24px;max-width:220px;padding:0 4px 0 8px;background:var(--td-bg-color-secondarycontainer);border:1px solid var(--td-component-border);border-radius:var(--lc-radius);font:var(--td-font-body-small)}
.lc-chip-type{color:var(--td-brand-color);font-weight:600}
.lc-chip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--td-text-color-secondary)}
.lc-chip-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 auto;border:0;background:transparent;color:var(--lc-icon-muted);cursor:pointer;padding:0;border-radius:var(--td-radius-small);transition:color .2s,background-color .2s}
.lc-chip-x:hover{color:var(--lc-icon-strong);background:var(--td-bg-color-component)}
.lc-quick{display:flex;gap:8px;flex-wrap:wrap}
.lc-chip-btn{display:inline-flex;align-items:center;justify-content:center;height:var(--td-comp-size-s);padding:0 11px;border:1px solid var(--td-border-level-2-color);border-radius:var(--lc-radius);background:var(--td-bg-color-specialcomponent);color:var(--td-text-color-primary);cursor:pointer;font:var(--td-font-body-small);gap:4px;transition:color .2s,border-color .2s}
.lc-chip-btn:hover{color:var(--td-brand-color-hover);border-color:var(--td-brand-color-hover)}
.lc-input{width:100%;box-sizing:border-box;min-height:36px;background:transparent;color:var(--dsw-alias-label-primary,var(--td-text-color-primary));border:0;border-radius:0;padding:12px 14px 4px;font:14px/24px var(--dsw-font-family,var(--td-font-family));caret-color:var(--dsw-alias-state-business-primary,var(--td-brand-color));outline:none;resize:none;overflow-y:auto}
.lc-input::placeholder{color:var(--dsw-alias-label-caption,var(--td-text-color-placeholder))}
.lc-input:hover{background:transparent}
.lc-input:focus,.lc-input:focus-visible{outline:none;border:0;box-shadow:none}
.lc-resize{display:flex;align-items:center;justify-content:center;height:10px;margin:-6px 0 -2px;cursor:ns-resize;user-select:none}
.lc-resize::before{content:'';width:38px;height:3px;border-radius:var(--td-radius-round);background:var(--td-border-level-2-color)}
.lc-resize:hover::before{background:var(--td-brand-color)}
.lc-composer-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;padding:2px 8px 8px 10px}
.lc-composer-tools{display:flex;align-items:center;gap:2px;flex:0 0 auto;min-width:0}
.lc-tool-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--lc-icon);cursor:pointer;transition:background-color .12s,color .12s}
.lc-tool-btn:hover:not(:disabled){background:var(--td-bg-color-container-hover);color:var(--td-text-color-primary)}
.lc-tool-btn:disabled{opacity:.45;cursor:default}
.lc-tool-recording{color:var(--td-error-color)}
.lc-tool-recording svg{animation:lc-pulse 1.1s ease-in-out infinite}
@keyframes lc-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.lc-composer-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0}
.lc-model-wrap{position:relative;display:inline-flex;align-items:center;min-width:0;color:var(--td-text-color-secondary)}
.lc-model-wrap>svg{position:absolute;right:7px;pointer-events:none;opacity:.7}
.lc-model-chip{display:inline-flex;align-items:center;height:28px;max-width:150px;min-width:0;padding:0 24px 0 9px;border:0;border-radius:14px;background:transparent;color:var(--td-text-color-secondary);font-size:12px;line-height:18px;cursor:pointer;transition:background-color .12s,color .12s;appearance:none;-webkit-appearance:none;text-overflow:ellipsis}
.lc-model-chip:hover{background:var(--td-bg-color-container-hover);color:var(--td-text-color-primary)}
.lc-model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-hint{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption,var(--td-text-color-placeholder))}
.lc-menu-backdrop{position:fixed;inset:0;z-index:39}
.lc-context-menu{position:fixed;z-index:41;min-width:168px;padding:4px;border:1px solid var(--td-component-stroke);border-radius:8px;background:var(--td-bg-color-container);box-shadow:var(--td-shadow-3,0 6px 24px rgba(0,0,0,.12))}
.lc-context-item{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--td-text-color-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.lc-context-item:hover{background:var(--td-bg-color-container-hover)}
.lc-context-item svg{color:var(--td-text-color-secondary)}
.lc-context-head{padding:6px 10px 8px;margin-bottom:2px;border-bottom:1px solid var(--td-component-stroke);color:var(--td-text-color-placeholder);font-size:12px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-context-item-current{color:var(--td-text-color-placeholder);cursor:default}
.lc-context-check{margin-left:auto;font-size:11px;color:var(--td-text-color-placeholder)}
.lc-context-item .lc-status-dot{width:6px;height:6px;border-radius:50%;background:var(--td-success-color)}
.lc-context-item .lc-status-dot-suspended{background:var(--td-warning-color)}
.lc-context-item .lc-status-dot-closed{background:var(--td-text-color-placeholder)}
.lc-context-subwrap{position:relative}
.lc-context-sub{display:none;position:absolute;left:calc(100% + 4px);top:-4px;min-width:148px}
.lc-context-subwrap:hover .lc-context-sub{display:block}
.lc-context-subwrap>.lc-context-item{width:100%}
.lc-context-caret{display:inline-flex;align-items:center;margin-left:auto;color:var(--td-text-color-placeholder)}
.lc-modal-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.lc-composer-menu{position:absolute;z-index:40;left:16px;bottom:calc(100% - 8px);width:min(320px,calc(100% - 32px));max-height:min(360px,60vh);display:flex;flex-direction:column;border-radius:10px;background:var(--td-bg-color-container);border:1px solid var(--td-component-stroke);box-shadow:var(--td-shadow-3,0 6px 24px rgba(0,0,0,.12));overflow:hidden}
.lc-composer-menu-right{left:auto;right:16px}
.lc-menu-head{padding:10px 12px 6px;font-size:12px;line-height:18px;color:var(--td-text-color-placeholder);flex:0 0 auto}
.lc-menu-body{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-height:0;overflow:auto;padding:0 4px 4px}
.lc-menu-item{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--td-text-color-primary);font:var(--td-font-body-medium);text-align:left;cursor:pointer}
.lc-menu-item:hover{background:var(--td-bg-color-container-hover)}
.lc-menu-item-active{background:var(--td-brand-color-light);color:var(--td-text-color-brand)}
.lc-menu-item-main{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-menu-item-meta{flex:0 0 auto;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--td-text-color-placeholder)}
.lc-menu-icon-placeholder{width:16px;height:16px;flex:0 0 16px}
.lc-menu-group{display:flex;flex-direction:column;gap:2px}
.lc-menu-group-label{padding:8px 8px 2px;font-size:12px;line-height:18px;color:var(--td-text-color-placeholder)}
.lc-menu-empty{padding:12px 10px;font-size:12px;color:var(--td-text-color-placeholder)}
@container (max-width: 520px){.lc-hint{display:none}}
.lc-send{flex:0 0 auto;display:grid;place-items:center;width:34px;height:34px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-button-info-fill,var(--td-brand-color));color:#fff;cursor:pointer;transition:background-color .1s}
.lc-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--td-brand-color-hover))}
.lc-send:disabled{opacity:.4;cursor:default}
.lc-send.lc-send-busy:disabled{opacity:1;cursor:progress}
.lc-spinner{width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:lc-spin .8s linear infinite}
@media (prefers-reduced-motion:reduce){.lc-spinner{animation:none;border-right-color:currentColor;opacity:.6}}
.lc-select-wrap{position:relative;display:flex;align-items:center;flex:1 1 auto;min-width:0}
.lc-select-caret{position:absolute;right:8px;display:flex;color:var(--lc-icon);pointer-events:none}
.lc-right{position:relative}
.lc-panel-badge-dot{position:absolute;top:0;right:0;width:6px;height:6px;border-radius:50%;background:#e34d59;z-index:2}
.lc-version-line{display:inline-flex;align-items:center;gap:8px;min-width:0}
.lc-settings-btn{flex:0 0 auto}
.lc-model-select{height:26px;max-width:150px;min-width:90px;padding:0 22px 0 8px;border:1px solid var(--td-component-stroke);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font-size:12px;line-height:24px;cursor:pointer;appearance:auto}
.lc-model-select:hover{border-color:var(--td-brand-color)}
.lc-model-select:focus{outline:none;border-color:var(--td-brand-color)}
.lc-modal-section{font-size:12px;font-weight:600;color:var(--td-text-color-secondary);padding-top:2px}
.lc-modal-hint{padding:8px 0;color:var(--td-text-color-secondary);font-size:13px}
.lc-check-update{position:relative;display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:transparent;color:var(--td-text-color-brand);font-size:11px;line-height:16px;cursor:pointer;white-space:nowrap}
.lc-check-update:hover{text-decoration:underline}
.lc-check-update:disabled{color:var(--td-text-color-placeholder);cursor:default;text-decoration:none}
.lc-check-update-new{font-weight:600}
.lc-update-dot{width:6px;height:6px;border-radius:50%;background:var(--td-error-color);display:inline-block}
.lc-update-pop{position:absolute;right:0;left:auto;bottom:calc(100% + 8px);z-index:45;width:calc(var(--lc-left-w, 300px) - 24px);max-width:calc(100vw - 24px);display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid var(--td-component-stroke);background:var(--td-bg-color-container);box-shadow:var(--td-shadow-3,0 6px 24px rgba(0,0,0,.12));font-size:12px;line-height:18px;color:var(--td-text-color-secondary);box-sizing:border-box}
.lc-update-pop-info{border-color:var(--td-brand-color-focus)}
.lc-update-pop-ok{border-color:var(--td-success-color-focus)}
.lc-update-pop-error{border-color:var(--td-error-color-focus);color:var(--td-error-color)}
.lc-update-pop-text{flex:1;min-width:0;word-break:break-word}
.lc-update-pop-close{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.lc-update-pop-close:hover{background:var(--td-bg-color-container-hover)}
.lc-bell-btn{position:relative;flex:0 0 auto}
.lc-bell-dot{position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:var(--td-error-color);box-shadow:0 0 0 1.5px var(--td-bg-color-container)}
.lc-btn-badge{position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--td-error-color);color:#fff;font-size:9px;line-height:14px;text-align:center;font-weight:500}
.lc-assign-menu{position:absolute;right:0;left:auto;bottom:calc(100% + 8px);z-index:40;width:calc(var(--lc-left-w, 300px) - 24px);max-width:calc(100vw - 24px);max-height:min(440px,74vh);display:flex;flex-direction:column;background:var(--td-bg-color-container);border:1px solid var(--td-component-stroke);border-radius:10px;box-shadow:var(--td-shadow-3,0 6px 24px rgba(0,0,0,.12));overflow:hidden;-webkit-app-region:no-drag}
.lc-assign-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 6px;flex:0 0 auto;font-size:12px;line-height:18px;color:var(--td-text-color-placeholder)}
.lc-assign-text-btn{border:0;background:transparent;color:var(--td-text-color-brand);font-size:12px;cursor:pointer;padding:0}
.lc-assign-list{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-height:0;overflow:auto;padding:0 4px 4px}
.lc-assign-item{display:flex;align-items:flex-start;gap:6px;padding:7px 6px;border-radius:6px;min-width:0}
.lc-assign-item:hover{background:var(--td-bg-color-container-hover)}
.lc-assign-item-read{opacity:.65}
.lc-assign-unread-dot{width:6px;height:6px;border-radius:50%;background:var(--td-error-color);flex:0 0 auto;margin-top:7px}
.lc-assign-item-main{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0;padding:0;border:0;background:transparent;color:var(--td-text-color-primary);text-align:left;cursor:pointer;font:inherit;text-decoration:none}
.lc-assign-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--td-font-body-medium)}
.lc-assign-item-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-assign-actions{display:flex;align-items:center;gap:0;flex:0 0 auto}
.lc-assign-actions .lc-icon-btn{width:24px;height:24px}
.lc-assign-empty{padding:12px 8px;font-size:12px;color:var(--td-text-color-placeholder)}
.lc-assign-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-top:1px solid var(--td-component-stroke);flex:0 0 auto;font-size:12px;color:var(--td-text-color-secondary)}
.lc-assign-toast{position:absolute;right:16px;top:56px;z-index:45;width:300px;max-width:calc(100% - 32px);display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;background:#fff7e6;border:1px solid #f0c36d;border-left:3px solid #ed7b2f;box-shadow:0 8px 28px rgba(0,0,0,.16);-webkit-app-region:no-drag}
body[data-ds-dark-theme] .lc-root .lc-assign-toast{background:#2e2718;border-color:#6b5420;border-left-color:#ed7b2f}
body[data-ds-dark-theme] .lc-root .lc-assign-toast-head{color:#f0d9a8}
.lc-assign-toast-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;line-height:18px;color:var(--td-text-color-secondary)}
.lc-assign-toast-body{display:flex;flex-direction:column;gap:4px}
.lc-assign-toast-row{display:flex;align-items:center;gap:6px;min-width:0;font:var(--td-font-body-medium)}
.lc-assign-kind{flex:0 0 auto;padding:0 4px;border-radius:3px;background:var(--td-bg-color-container-hover);font-size:11px;line-height:16px;color:var(--td-text-color-secondary)}
.lc-assign-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;text-decoration:none;cursor:pointer}
.lc-assign-title:hover,.lc-assign-item-main:hover .lc-assign-item-title{text-decoration:underline;color:var(--td-brand-color)}
.lc-assign-meta{flex:0 0 auto;font-size:11px;color:var(--td-text-color-placeholder)}
.lc-assign-toast-actions{display:flex;gap:8px;justify-content:flex-end}
.lc-history-menu{position:absolute;top:52px;right:8px;z-index:40;width:300px;max-width:calc(100% - 16px);max-height:min(420px,72vh);display:flex;flex-direction:column;background:var(--td-bg-color-container);border:1px solid var(--td-component-stroke);border-radius:10px;box-shadow:var(--td-shadow-3,0 6px 24px rgba(0,0,0,.12));overflow:hidden;-webkit-app-region:no-drag}
.lc-history-head{padding:10px 12px 6px;flex:0 0 auto;font-size:12px;line-height:18px;color:var(--td-text-color-placeholder)}
.lc-history-list{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-height:0;overflow:auto;padding:0 4px 6px}
.lc-history-item{display:flex;align-items:center;gap:2px;padding:1px 2px 1px 8px;border-radius:6px;min-width:0}
.lc-history-item:hover{background:var(--td-bg-color-container-hover)}
.lc-history-item-active{background:var(--dsw-alias-interactive-bg-active)}
.lc-history-main{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;padding:7px 0;border:0;background:transparent;color:var(--td-text-color-primary);font:var(--td-font-body-medium);text-align:left;cursor:pointer}
.lc-history-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-history-time{flex:0 0 auto;font-size:12px;color:var(--td-text-color-placeholder)}
.lc-history-action{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:0 0 auto;border:0;border-radius:50%;background:transparent;color:var(--lc-icon-muted);cursor:pointer;opacity:0;transition:opacity .12s,color .12s}
.lc-history-item:hover .lc-history-action,.lc-history-item-active .lc-history-action{opacity:1}
.lc-history-action:hover{color:var(--lc-icon-strong);background:var(--td-bg-color-container-hover)}
.lc-history-archived-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin-top:4px;padding:8px;border:0;border-top:1px solid var(--td-component-stroke);background:transparent;color:var(--td-text-color-secondary);font-size:12px;line-height:18px;cursor:pointer}
.lc-history-archived-toggle:hover{color:var(--td-text-color-primary)}
.lc-history-empty{padding:10px 8px;font-size:12px;color:var(--td-text-color-placeholder)}
.lc-history-item-editing{background:var(--td-bg-color-container-hover)}
.lc-history-item-editing .lc-history-action{opacity:1}
.lc-history-edit{flex:1 1 auto;min-width:0;padding:4px 0}
.lc-history-input{width:100%;box-sizing:border-box;height:28px;padding:0 8px;border:1px solid var(--td-brand-color);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:var(--td-font-body-medium);outline:none}
.lc-tree::-webkit-scrollbar,.lc-table-wrap::-webkit-scrollbar,.lc-chat::-webkit-scrollbar,.lc-input::-webkit-scrollbar{width:6px;height:6px}
.lc-tree::-webkit-scrollbar-thumb,.lc-table-wrap::-webkit-scrollbar-thumb,.lc-chat::-webkit-scrollbar-thumb,.lc-input::-webkit-scrollbar-thumb{background:var(--td-scrollbar-color);border-radius:11px}
.lc-tree::-webkit-scrollbar-thumb:hover,.lc-table-wrap::-webkit-scrollbar-thumb:hover,.lc-chat::-webkit-scrollbar-thumb:hover,.lc-input::-webkit-scrollbar-thumb:hover{background:var(--td-scrollbar-hover-color)}
.lc-tree::-webkit-scrollbar-track,.lc-table-wrap::-webkit-scrollbar-track,.lc-chat::-webkit-scrollbar-track,.lc-input::-webkit-scrollbar-track{background:transparent}

.lc-page{flex:1 1 auto;display:flex;width:100%;min-width:0;min-height:0;overflow:hidden;padding:0;background:var(--td-bg-color-container)}
.lc-page-inner{flex:1 1 auto;width:100%;height:100%;max-width:none;margin:0;display:flex;min-width:0;min-height:0}
.lc-field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.lc-field-hint{font-size:11px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-modal-error{padding:8px 10px;border-radius:6px;background:var(--td-error-color-light);color:var(--td-error-color);font-size:12px;line-height:18px}
.lc-batch-input{min-height:138px!important;resize:vertical}
.lc-batch-rows{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto;margin-top:4px}
.lc-batch-rows .lc-batch-row{flex-direction:row;align-items:center;gap:8px;padding:6px 8px}
.lc-batch-rows .lc-batch-row .lc-input{flex:1 1 auto;min-width:0;height:30px;min-height:30px;font-size:12px}
.lc-batch-date{flex:0 0 140px!important;width:140px}
.lc-batch-index{width:16px;flex:0 0 16px;text-align:right}
.lc-day-detail-close{flex:0 0 auto}
.lc-day-detail-actions{display:flex;justify-content:flex-end;padding-top:2px}
.lc-btn-danger{color:var(--td-error-color);border-color:var(--td-error-color)}
.lc-btn-danger:hover:not(:disabled){background:var(--td-error-color-light);border-color:var(--td-error-color)}
.lc-nav{flex:0 0 76px;width:76px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:57px 0 18px;border-right:0;background:var(--lc-brand);z-index:2}
.lc-nav-btn{width:60px;height:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;border:0;border-radius:12px;background:transparent;color:rgba(255,255,255,.86);font:500 11px/1 var(--td-font-family);cursor:pointer;transition:background .15s,color .15s}
.lc-nav-btn:hover{background:rgba(255,255,255,.16);color:#fff}
.lc-nav-btn-active,.lc-nav-btn-active:hover{background:#fff;color:var(--lc-brand)}
.lc-nav-update{margin-top:auto}
.lc-update-dialog{width:480px}
.lc-update-body{padding-top:14px;gap:14px}
.lc-update-loading{display:flex;align-items:center;gap:10px;padding:18px 0;color:var(--td-text-color-secondary);font-size:13px}
.lc-update-content{display:flex;flex-direction:column;gap:12px}
.lc-update-versions{display:flex;align-items:center;gap:10px}
.lc-update-version{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;padding:9px 12px;border:1px solid var(--td-component-stroke);border-radius:8px;background:var(--td-bg-color-page)}
.lc-update-version span{font-size:11px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-update-version strong{font-size:17px;line-height:22px;color:var(--td-text-color-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-update-version-latest strong{color:var(--td-brand-color)}
.lc-update-arrow{flex:0 0 auto;color:var(--td-text-color-placeholder);font-size:14px}
.lc-update-status{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-radius:6px;font-size:12px;line-height:18px}
.lc-update-status svg{flex:0 0 auto;margin-top:1px}
.lc-update-status.is-new{background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-update-status.is-latest{background:var(--td-success-color-light);color:var(--td-success-color)}
.lc-update-error{padding:9px 11px;border-radius:6px;background:var(--td-error-color-light);color:var(--td-error-color);font-size:12px;line-height:18px;word-break:break-word}
.lc-update-intro{display:flex;flex-direction:column;gap:4px}
.lc-update-intro strong{font-size:13px;color:var(--td-text-color-primary)}
.lc-update-intro p{margin:0;font-size:12px;line-height:18px;color:var(--td-text-color-secondary)}
.lc-update-notes-wrap{display:flex;flex-direction:column;gap:5px}
.lc-update-notes-title{font-size:12px;color:var(--td-text-color-secondary)}
.lc-update-notes{max-height:170px;overflow:auto;margin:0;padding:10px 12px;border-radius:6px;background:var(--td-bg-color-page);color:var(--td-text-color-primary);font:12px/18px var(--td-font-family);white-space:pre-wrap;word-break:break-word}
.lc-update-hint{margin:0;font-size:11px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-update-source{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;line-height:16px;color:var(--td-text-color-placeholder);word-break:break-all}
.lc-update-linkbtn{border:0;background:transparent;color:var(--td-brand-color);font-size:11px;line-height:16px;cursor:pointer;padding:0;flex:0 0 auto}
.lc-update-repo{display:flex;flex-direction:column;gap:6px;padding-top:12px;border-top:1px solid var(--td-component-stroke)}
.lc-update-repo-label{font-size:12px;line-height:18px;color:var(--td-text-color-secondary)}
.lc-update-foot{padding-top:16px}
.lc-update-foot .lc-btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;box-sizing:border-box}
.lc-stage{flex:1 1 0%;width:100%;display:flex;min-width:0;min-height:0;overflow:hidden}
.lc-tasks{flex:1 1 auto;display:grid;grid-template-columns:var(--lc-side-w,220px) 5px minmax(0,1fr) 5px var(--lc-detail-w,380px);min-width:0;min-height:0;height:100%;background:var(--td-bg-color-container);overflow:hidden}
.lc-task-page{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0}
.lc-task-top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 24px 16px;background:var(--lc-brand);color:#fff;-webkit-app-region:drag;app-region:drag;user-select:none;-webkit-user-select:none}
.lc-task-top-title{font:600 20px/28px var(--td-font-family);letter-spacing:.2px}
.lc-task-top-main{min-width:0}
.lc-task-top-sub{margin-top:3px;font:400 12px/18px var(--td-font-family);color:rgba(255,255,255,.78);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-task-top-stats{display:flex;align-items:baseline;gap:16px;font:400 12px/18px var(--td-font-family);color:rgba(255,255,255,.78);white-space:nowrap}
.lc-task-top-stats span{display:inline-flex;align-items:baseline;gap:5px}
.lc-task-top-stats b{font:600 18px/22px var(--td-font-family);color:#fff;font-variant-numeric:tabular-nums}
.lc-task-page .lc-tasks{height:auto;flex:1 1 auto;min-height:0}
@media (max-width:720px){.lc-task-top{padding:14px 14px 12px;gap:10px}.lc-task-top-title{font-size:17px;line-height:24px}.lc-task-top-sub{font-size:11px;line-height:16px}.lc-task-top-stats{gap:10px;font-size:11px}.lc-task-top-stats b{font-size:16px}}
.lc-task-side{min-width:0;min-height:0;overflow:auto;padding:20px 12px;background:var(--td-bg-color-container)}
.lc-split{position:relative;z-index:3;cursor:col-resize;background:transparent;touch-action:none;outline:none}
.lc-split:before{content:'';position:absolute;top:0;bottom:0;left:2px;width:1px;background:var(--td-component-stroke);transition:background .12s}
.lc-split:hover:before,.lc-split:focus-visible:before,.lc-split:active:before{width:2px;left:1.5px;background:var(--td-brand-color)}
.lc-split-grip{position:absolute;top:50%;left:50%;width:3px;height:26px;margin:-13px 0 0 -1px;border-radius:2px;background:var(--td-component-stroke);opacity:0;transition:opacity .12s}
.lc-split:hover .lc-split-grip,.lc-split:focus-visible .lc-split-grip{opacity:1;background:var(--td-brand-color)}
.lc-tasks .lc-day-detail{border-left:0}
body.lc-col-resizing{cursor:col-resize;user-select:none}
body.lc-col-resizing *{cursor:col-resize!important;user-select:none!important}
.lc-task-side-title{padding:0 10px 12px;font:600 15px/24px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-task-side-nav{display:flex;flex-direction:column;gap:2px}
.lc-task-side-item{display:flex;align-items:center;gap:9px;width:100%;height:36px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--td-text-color-primary);font:400 13px/20px var(--td-font-family);text-align:left;cursor:pointer}
.lc-task-side-item:hover{background:var(--td-bg-color-container-hover,#f5f5f5)}
.lc-task-side-item-active,.lc-task-side-item-active:hover{background:var(--td-brand-color-light);color:var(--td-brand-color);font-weight:500}
.lc-task-side-icon{display:flex;align-items:center;justify-content:center;flex:0 0 16px;color:var(--td-text-color-secondary)}
.lc-task-side-item-active .lc-task-side-icon{color:var(--td-brand-color)}
.lc-task-side-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-task-side-count{flex:0 0 auto;font-size:12px;color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-task-side-item-active .lc-task-side-count{color:var(--td-brand-color)}
.lc-task-side-title-cats{margin-top:18px;padding-top:16px;border-top:1px solid var(--td-component-stroke)}
.lc-task-cat-nav .lc-task-side-item{height:34px}
.lc-task-cat-dot{flex:0 0 10px;width:10px;height:10px;border-radius:50%;background:var(--td-text-color-placeholder)}
.lc-task-cat-dot-all{background:var(--td-brand-color)}
.lc-task-cat-dot-none{background:#9aa3ad}
.lc-task-main{min-width:0;min-height:0;overflow:auto;padding:22px 28px 40px;background:var(--td-bg-color-container)}
.lc-task-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.lc-task-head h2{margin:0;font:600 20px/28px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-task-head-count{font:400 12px/20px var(--td-font-family);color:var(--td-text-color-placeholder);white-space:nowrap}
.lc-task-add{display:flex;align-items:center;gap:9px;height:42px;padding:0 12px;margin-bottom:18px;border-radius:10px;background:var(--td-bg-color-page,#f5f5f5);color:var(--td-text-color-placeholder);cursor:text}
.lc-task-add:focus-within{box-shadow:0 0 0 1px var(--td-brand-color) inset;background:var(--td-bg-color-container)}
.lc-task-add input{flex:1 1 auto;min-width:0;border:0;outline:none;background:transparent;color:var(--td-text-color-primary);font:400 13px/20px var(--td-font-family)}
.lc-task-add input::placeholder{color:var(--td-text-color-placeholder)}
.lc-task-group{margin-bottom:18px}
.lc-task-group-head{display:flex;align-items:center;gap:7px;padding:4px 6px 8px;border-radius:6px;font:500 12px/18px var(--td-font-family);color:var(--td-text-color-secondary);cursor:pointer;user-select:none;transition:background .15s}
.lc-task-group-head:hover{background:var(--td-bg-color-container-hover)}
.lc-task-group-head:focus-visible{outline:2px solid var(--td-brand-color-focus);outline-offset:2px}
.lc-task-group-head.is-collapsed{color:var(--td-text-color-placeholder)}
.lc-task-group-arrow{display:inline-flex;align-items:center;justify-content:center;width:14px;flex:0 0 auto;color:var(--td-text-color-secondary);opacity:.85}
.lc-task-group-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-task-group-head b{font-weight:500;color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-task-group-dropped{margin-top:24px;padding-top:14px;border-top:1px dashed var(--td-component-stroke)}
.lc-task-group-dropped .lc-task-group-head{color:var(--td-text-color-placeholder)}
.lc-task-group-done{margin-top:18px;padding-top:12px;border-top:1px dashed var(--td-component-stroke)}
.lc-task-group-done .lc-task-group-head{color:var(--td-text-color-placeholder)}
.lc-tomato-marks{display:inline-flex;align-items:center;gap:1px;flex:0 0 auto;line-height:1;font-size:10px;vertical-align:middle}
.lc-tomato{font-size:10px;line-height:1}
.lc-tomato-extra{font-size:9px;line-height:1;color:var(--td-text-color-placeholder);margin-left:1px}
.lc-day-event-tomatoes{flex:0 0 auto;align-self:flex-start;margin-top:2px}
.lc-cal-task{display:flex;align-items:center;gap:4px}
.lc-cal-task-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-cal-task-tomatoes{flex:0 0 auto}
.lc-cal-task-week .lc-cal-task-link{display:flex;align-items:flex-start;gap:4px}
.lc-cal-task-week .lc-cal-task-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;word-break:break-all;line-height:16px}
.lc-day-focus-row{display:flex;flex:0 0 auto;align-items:center;flex-wrap:wrap;gap:6px;margin-top:12px;padding:8px 10px;border-radius:8px;background:var(--td-bg-color-secondarycontainer,#f6f7f9)}
.lc-day-focus-label{font-size:10px;line-height:16px;color:var(--td-text-color-placeholder)}
.lc-day-focus-time{font:600 12px/18px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums}
.lc-day-focus-marks{font-size:12px}
.lc-day-focus-marks .lc-tomato{font-size:12px}
.lc-day-pomo-btn{margin-left:auto;height:24px;padding:0 8px;border:1px solid var(--td-brand-color);border-radius:6px;background:transparent;color:var(--td-brand-color);font:500 11px/22px var(--td-font-family);cursor:pointer;white-space:nowrap}
.lc-day-pomo-btn:hover{background:var(--td-brand-color-light)}

.lc-pomo-mask{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.45)}
.lc-modal.lc-pomo-dialog{width:min(432px,100%);max-height:calc(100vh - 40px);overflow:auto}
.lc-pomo-setup-body{gap:14px;padding-top:14px}
.lc-pomo-setup-icon{flex:0 0 auto;font-size:14px;line-height:18px}
.lc-pomo-setup-title{font:600 12px/18px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-pomo-preview-time{font:600 34px/44px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums}
.lc-pomo-preview-hint{font:400 11px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-setup-note{margin:0;font:400 11px/17px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-dialog{width:min(430px,100%);max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;background:var(--td-bg-color-container);border-radius:12px;box-shadow:0 18px 48px rgba(15,23,42,.24)}
.lc-pomo-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:18px 20px 0}
.lc-pomo-dialog-head h2{margin:0;font:600 16px/24px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-pomo-dialog-head p{margin:3px 0 0;font:400 11px/17px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-dialog-body{display:flex;flex-direction:column;gap:14px;padding:14px 20px 4px}
.lc-pomo-setup-task{display:flex;align-items:center;gap:7px;min-width:0;padding:9px 11px;border-radius:8px;background:var(--td-bg-color-secondarycontainer,#f6f7f9);font:500 12px/18px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-pomo-setup-task span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-pomo-modes{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:3px;border-radius:9px;background:var(--td-bg-color-secondarycontainer,#f2f3f5)}
.lc-pomo-mode{height:30px;border:0;border-radius:7px;background:transparent;color:var(--td-text-color-secondary);font:500 12px/30px var(--td-font-family);cursor:pointer;transition:background .12s,color .12s}
.lc-pomo-mode:hover{color:var(--td-text-color-primary)}
.lc-pomo-mode.is-active{background:var(--td-bg-color-container);color:var(--td-brand-color);font-weight:600;box-shadow:0 1px 4px rgba(15,23,42,.12)}
.lc-pomo-label{font:500 12px/18px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-pomo-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.lc-pomo-preset{height:36px;border:1px solid var(--td-component-border,#dcdcdc);border-radius:8px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:500 12px/34px var(--td-font-family);cursor:pointer;transition:border-color .12s,background .12s,color .12s}
.lc-pomo-preset:hover{border-color:var(--td-brand-color);color:var(--td-brand-color)}
.lc-pomo-preset.is-active{border-color:var(--td-brand-color);background:var(--td-brand-color-light);color:var(--td-brand-color);font-weight:600}
.lc-pomo-custom{display:flex;align-items:center;gap:8px}
.lc-pomo-custom input{width:110px;height:34px;box-sizing:border-box;padding:0 10px;border:1px solid var(--td-border-level-2-color);border-radius:7px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:400 13px/32px var(--td-font-family)}
.lc-pomo-custom input:focus{outline:0;border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-focus)}
.lc-pomo-custom span{font:400 11px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-preview{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:86px;border-radius:10px;background:var(--td-bg-color-secondarycontainer,#f6f7f9);color:var(--td-text-color-primary);font:600 34px/44px var(--td-font-family);font-variant-numeric:tabular-nums}
.lc-pomo-preview .lc-pomo-preview-time{font:600 34px/42px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums}
.lc-pomo-preview .lc-pomo-preview-hint{font:400 10px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-hint{margin:0;font:400 11px/17px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-setup-error{margin:0;font:400 11px/17px var(--td-font-family);color:var(--td-error-color)}
.lc-pomo-dialog-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px 18px}

.lc-praise-mask{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.42);animation:lc-praise-fade .18s ease-out both}
.lc-praise{position:relative;width:min(370px,100%);overflow:hidden;padding:30px 28px 22px;border:1px solid rgba(255,255,255,.7);border-radius:22px;background:linear-gradient(180deg,#fffaf0 0%,#fff 58%);box-shadow:0 22px 70px rgba(15,23,42,.28);text-align:center;animation:lc-praise-pop .42s cubic-bezier(.2,.9,.25,1.12) both}
.lc-praise:before{content:'';position:absolute;left:-40%;top:-60%;width:180%;height:120%;background:radial-gradient(circle at 50% 40%,rgba(246,183,60,.22),transparent 62%);pointer-events:none}
.lc-praise-burst{position:absolute;left:50%;top:108px;width:0;height:0;z-index:2;pointer-events:none}
.lc-praise-spark{position:absolute;left:0;top:0;width:6px;height:6px;margin:-3px;border-radius:50%;background:#f6b73c;animation:lc-praise-spark .92s cubic-bezier(.2,.7,.3,1) both}
.lc-praise-spark:nth-child(3n){background:#ff8a5c}
.lc-praise-spark:nth-child(3n+1){background:#7aa2ff}
.lc-praise-badge{position:relative;z-index:1;width:136px;height:136px;margin:0 auto 14px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle at 38% 30%,#fff7dc 0%,#ffe6a6 48%,#ffd46e 100%);box-shadow:0 12px 30px rgba(246,183,60,.32),inset 0 0 0 8px rgba(255,255,255,.38)}
.lc-praise-badge:before,.lc-praise-badge:after{content:'';position:absolute;inset:-9px;border-radius:50%;border:2px solid rgba(246,183,60,.5);animation:lc-praise-ring 1.25s ease-out .12s both}
.lc-praise-badge:after{animation-delay:.34s;border-color:rgba(255,138,92,.36)}
.lc-praise-thumb{display:block;font-size:78px;line-height:1;filter:drop-shadow(0 8px 10px rgba(180,110,0,.2));animation:lc-praise-thumb .95s cubic-bezier(.18,.89,.32,1.28) both}
.lc-praise-kicker{margin:0 0 4px;font:600 11px/18px var(--td-font-family);letter-spacing:.16em;color:#b7791f}
.lc-praise-title{margin:0;font:700 24px/1.35 var(--td-font-family);color:#1f2937}
.lc-praise-copy{margin:8px auto 0;max-width:300px;font:400 12.5px/1.75 var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-praise-stats{display:flex;align-items:center;justify-content:center;gap:8px;margin:14px 0 18px;flex-wrap:wrap}
.lc-praise-stats span{display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:13px;background:#fff4d6;color:#9a6700;font:600 11.5px/26px var(--td-font-family)}
.lc-praise-stats span + span{background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-praise-btn{width:100%;height:40px;font-weight:600}
@keyframes lc-praise-fade{from{opacity:0}to{opacity:1}}
@keyframes lc-praise-pop{0%{opacity:0;transform:translateY(14px) scale(.9)}60%{opacity:1;transform:translateY(-3px) scale(1.02)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes lc-praise-thumb{0%{opacity:0;transform:scale(.25) rotate(-20deg)}55%{opacity:1;transform:scale(1.14) rotate(7deg)}76%{transform:scale(.96) rotate(-3deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
@keyframes lc-praise-ring{0%{opacity:.7;transform:scale(.86)}100%{opacity:0;transform:scale(1.28)}}
@keyframes lc-praise-spark{0%{opacity:0;transform:rotate(var(--a)) translateY(0) scale(.3)}25%{opacity:1}100%{opacity:0;transform:rotate(var(--a)) translateY(calc(-1 * var(--d))) scale(1)}}
body[data-ds-dark-theme] .lc-root .lc-praise{background:linear-gradient(180deg,#2a2418 0%,#1e1e1e 58%);border-color:#3b3324}
body[data-ds-dark-theme] .lc-root .lc-praise-title{color:#fff}
body[data-ds-dark-theme] .lc-root .lc-praise-copy{color:rgba(255,255,255,.66)}
body[data-ds-dark-theme] .lc-root .lc-praise-stats span{background:rgba(246,183,60,.16);color:#f5c542}
body[data-ds-dark-theme] .lc-root .lc-praise-stats span + span{background:rgba(var(--lc-brand-rgb),.2);color:#8ab4ff}
@media (prefers-reduced-motion: reduce){.lc-praise,.lc-praise-thumb,.lc-praise-badge:before,.lc-praise-badge:after,.lc-praise-spark{animation:none!important}}
.lc-pomo-float{position:fixed;right:22px;bottom:22px;z-index:1100;width:272px;box-sizing:border-box;padding:12px 14px 12px;border:1px solid var(--td-component-stroke);border-radius:12px;background:var(--td-bg-color-container);box-shadow:0 14px 40px rgba(15,23,42,.22)}
.lc-pomo-float-paused{opacity:.92}
.lc-pomo-float-head{display:flex;align-items:center;gap:6px;min-width:0}
.lc-pomo-float-icon{font-size:13px;line-height:16px;flex:0 0 auto}
.lc-pomo-float-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12px/18px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-pomo-mode-tag{flex:0 0 auto;font:400 9px/14px var(--td-font-family);color:var(--td-text-color-placeholder);background:var(--td-bg-color-secondarycontainer);border-radius:4px;padding:0 4px}
.lc-pomo-clock{margin:5px 0 4px;text-align:center;font:600 30px/38px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums;letter-spacing:.5px}
.lc-pomo-progress{height:4px;border-radius:4px;background:var(--td-bg-color-secondarycontainer,#eee);overflow:hidden}
.lc-pomo-progress i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--lc-brand-light),var(--lc-brand));transition:width .5s linear}
.lc-pomo-float-meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font:400 10px/15px var(--td-font-family);color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-pomo-float-actions{display:flex;gap:8px;margin-top:10px}
.lc-pomo-float-btn{flex:1 1 0;height:30px;border:1px solid var(--td-component-border);border-radius:7px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:500 11px/28px var(--td-font-family);cursor:pointer}
.lc-pomo-float-btn:hover{background:var(--td-bg-color-container-hover)}
.lc-pomo-float-btn.is-primary{border-color:var(--td-brand-color);background:var(--td-brand-color);color:#fff}
.lc-pomo-float-btn.is-primary:hover{background:var(--td-brand-color-hover)}
.lc-pomo-float-btn.is-danger{color:var(--td-error-color);border-color:var(--td-error-color-focus)}
.lc-pomo-float-btn.is-danger:hover{background:var(--td-error-color-light)}

.lc-pomo-page{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;height:100%;background:var(--td-bg-color-page,#f4f5f7);overflow-y:auto}
.lc-pomo-head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:14px 24px;background:var(--lc-brand);color:#fff;-webkit-app-region:drag;app-region:drag;user-select:none;-webkit-user-select:none}
.lc-pomo-head-title h1{margin:0;font:600 18px/26px var(--td-font-family);color:#fff}
.lc-pomo-head-title p{margin:3px 0 0;font:400 12px/18px var(--td-font-family);color:rgba(255,255,255,.72)}
.lc-pomo-head-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;-webkit-app-region:no-drag;app-region:no-drag}
.lc-pomo-daynav{display:flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:rgba(255,255,255,.15)}
.lc-pomo-nav-btn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:#fff;cursor:pointer}
.lc-pomo-nav-btn:hover:not(:disabled){background:rgba(255,255,255,.18)}
.lc-pomo-nav-btn:disabled{opacity:.4;cursor:default}
.lc-pomo-day-label{padding:0 8px;font:500 12px/26px var(--td-font-family);color:#fff;white-space:nowrap;font-variant-numeric:tabular-nums}
.lc-pomo-today-btn{height:30px;padding:0 11px;border:1px solid rgba(255,255,255,.42);border-radius:8px;background:transparent;color:#fff;font:500 11px/28px var(--td-font-family);cursor:pointer}
.lc-pomo-today-btn:hover:not(:disabled){background:rgba(255,255,255,.16)}
.lc-pomo-today-btn:disabled{opacity:.5;cursor:default}
.lc-pomo-refresh{width:30px;height:30px;border:1px solid rgba(255,255,255,.42);border-radius:8px}
.lc-pomo-body{width:100%;max-width:none;margin:0;padding:16px 24px 28px;box-sizing:border-box;flex:1 1 auto}
.lc-pomo-content{display:flex;flex-direction:column;gap:14px}
.lc-pomo-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.lc-pomo-metric{position:relative;overflow:hidden;padding:13px 16px;border-radius:12px;background:var(--td-bg-color-container);box-shadow:0 1px 3px rgba(15,23,42,.05)}
.lc-pomo-metric:before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--td-brand-color)}
.lc-pomo-metric-tomato:before{background:#e34d59}
.lc-pomo-metric-label{display:block;font:400 11px/18px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-metric b{display:block;margin-top:3px;font:600 23px/31px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-pomo-metric-sub{display:block;margin-top:1px;font:400 10px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-trend-card,.lc-pomo-card{border-radius:12px;background:var(--td-bg-color-container);box-shadow:0 1px 3px rgba(15,23,42,.05)}
.lc-pomo-trend-card{padding:13px 16px 8px}
.lc-pomo-card{padding:13px 16px 6px;min-height:190px}
.lc-pomo-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.lc-pomo-card-head h2{margin:0;font:600 13px/21px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-pomo-card-head span{font:400 10px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-trend{display:flex;align-items:flex-end;gap:10px;height:148px;margin-top:6px;padding-bottom:2px;overflow-x:auto}
.lc-pomo-trend-day{flex:1 1 0;min-width:44px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;padding:3px 2px;border:0;border-radius:8px;background:transparent;cursor:pointer}
.lc-pomo-trend-day:hover{background:var(--td-bg-color-container-hover)}
.lc-pomo-trend-selected{box-shadow:inset 0 0 0 1px rgba(var(--lc-brand-rgb),.55)}
.lc-pomo-trend-active,.lc-pomo-trend-active:hover{background:var(--td-brand-color-light)}
.lc-pomo-trend-count{height:14px;font:400 10px/14px var(--td-font-family);color:#e34d59}
.lc-pomo-trend-bar{flex:1 1 auto;display:flex;align-items:flex-end;width:18px}
.lc-pomo-trend-bar i{display:block;width:100%;border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,var(--lc-brand-light),var(--lc-brand))}
.lc-pomo-trend-active .lc-pomo-trend-bar i{background:linear-gradient(180deg,#ffb04d,#e37318)}
.lc-pomo-trend-label{font:400 10px/14px var(--td-font-family);color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-pomo-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.lc-pomo-session-list,.lc-pomo-task-list{display:flex;flex-direction:column;margin-top:4px}
.lc-pomo-session-list{position:relative;padding-left:18px}
.lc-pomo-session-list:before{content:'';position:absolute;left:3px;top:12px;bottom:12px;width:2px;border-radius:2px;background:#cfd5dd}
.lc-pomo-session{position:relative;display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--td-component-stroke)}
.lc-pomo-session:before{content:'';position:absolute;left:-18px;top:50%;width:7px;height:7px;margin-top:-3.5px;border-radius:50%;background:var(--td-text-color-placeholder);opacity:.45}
.lc-pomo-session-done:before{background:var(--lc-brand);opacity:1}
.lc-pomo-session:last-child,.lc-pomo-task:last-child{border-bottom:0}
.lc-pomo-session-main{flex:1 1 auto;min-width:0}
.lc-pomo-session-main b{display:block;font:500 12px/18px var(--td-font-family);color:var(--td-text-color-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-pomo-session-meta{display:block;font:400 10px/15px var(--td-font-family);color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-pomo-badge{flex:0 0 auto;padding:1px 6px;border-radius:4px;background:var(--td-success-color-light);color:var(--td-success-color);font:500 10px/16px var(--td-font-family)}
.lc-pomo-badge-muted{background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-placeholder)}
.lc-pomo-task{display:flex;align-items:center;gap:10px;width:100%;padding:9px 4px;border:0;border-bottom:1px solid var(--td-component-stroke);background:transparent;text-align:left;cursor:pointer}
.lc-pomo-task:hover{background:var(--td-bg-color-container-hover)}
.lc-pomo-task-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 12px/18px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-pomo-task-meta{flex:0 0 auto;display:flex;align-items:center;gap:8px;font:400 10px/16px var(--td-font-family);color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-pomo-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:26px 10px 30px;text-align:center}
.lc-pomo-empty-icon{font-size:26px;line-height:34px;opacity:.85}
.lc-pomo-empty b{font:600 12px/20px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-pomo-empty p{margin:0;font:400 10px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-empty-small{padding:18px 8px;font:400 11px/17px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-tip{margin:0;text-align:center;font:400 10px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-loading{padding:80px 0;text-align:center;font:400 12px/20px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-pomo-error{margin-bottom:12px;padding:10px 12px;border-radius:8px;background:var(--td-error-color-light);color:var(--td-error-color);font:400 11px/18px var(--td-font-family);display:flex;align-items:center;justify-content:space-between;gap:10px}
.lc-pomo-error button{border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font:500 11px/24px var(--td-font-family);padding:0 8px;cursor:pointer}
body[data-ds-dark-theme] .lc-root .lc-pomo-trend-active,
body[data-ds-dark-theme] .lc-root .lc-pomo-trend-active:hover,
body[data-ds-dark-theme] .lc-root .lc-pomo-preset.is-active,
body[data-ds-dark-theme] .lc-root .lc-day-pomo-btn:hover{background:rgba(77,133,255,.18)}
body[data-ds-dark-theme] .lc-root .lc-pomo-float{box-shadow:0 16px 44px rgba(0,0,0,.55)}

@media (max-width:980px){
.lc-pomo-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
.lc-pomo-columns{grid-template-columns:1fr}
.lc-pomo-card{min-height:0}
}
@media (max-width:720px){
.lc-pomo-head{padding:12px 14px;gap:10px}
.lc-pomo-head-title p{display:none}
.lc-pomo-head-controls{gap:6px}
.lc-pomo-body{padding:12px 14px 22px}
.lc-pomo-metrics{gap:10px}
.lc-pomo-metric{padding:10px 12px}
.lc-pomo-metric b{font-size:20px;line-height:28px}
.lc-pomo-trend{gap:6px}
.lc-pomo-float{right:12px;bottom:12px;width:calc(100vw - 24px);max-width:272px}
.lc-pomo-dialog{width:100%}
}

.lc-task-row[draggable='true']{cursor:grab}
.lc-task-row-dragging{opacity:.45}
.lc-task-row-drop-before{box-shadow:inset 0 2px 0 var(--td-brand-color)}
.lc-task-row-drop-after{box-shadow:inset 0 -2px 0 var(--td-brand-color)}
.lc-task-row{display:flex;align-items:center;gap:11px;min-height:46px;padding:10px 8px;border-bottom:1px solid var(--td-component-stroke);border-radius:6px;cursor:pointer;transition:background .12s}
.lc-task-row:last-child{border-bottom:0}
.lc-task-row:hover{background:var(--td-bg-color-container-hover,#f7f7f7)}
.lc-task-row-active,.lc-task-row-active:hover{background:var(--td-brand-color-light)}
.lc-task-check{flex:0 0 auto;width:17px;height:17px;margin:0;accent-color:var(--td-brand-color);cursor:pointer}
.lc-task-check-dropped{display:inline-flex;align-items:center;justify-content:center;border:1.5px solid #b9c0c8;border-radius:4px;background:#e3e6ea;color:#6f7782;box-sizing:border-box;cursor:default}
.lc-task-check-dropped svg{display:block}
body[data-ds-dark-theme] .lc-root .lc-task-check-dropped{background:#3a3a3a;border-color:#5f5f5f;color:#b8b8b8}
body[data-ds-dark-theme] .lc-root .lc-cal-task-mark,
body[data-ds-dark-theme] .lc-root .lc-day-event-mark{background:#3a3a3a;border-color:#5f5f5f;color:#b8b8b8}
body[data-ds-dark-theme] .lc-root .lc-pomo-session-list:before{background:#4a4a4a}
.lc-task-row-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/20px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-task-row-done .lc-task-row-title{color:var(--td-text-color-placeholder);text-decoration:line-through}
.lc-task-row-meta{flex:0 0 auto;display:flex;align-items:center;gap:8px;font:400 11px/18px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-task-row-date{color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums;min-width:44px;text-align:right}
.lc-task-pri{display:inline-flex;align-items:center;height:18px;padding:0 5px;border-radius:4px;background:var(--td-bg-color-page,#f3f3f3);color:var(--td-text-color-placeholder);font-size:10px;line-height:18px}
.lc-task-pri-1{background:var(--td-error-color-light);color:var(--td-error-color)}
.lc-task-pri-2{background:#fff3cd;color:#9a6700}
.lc-task-pri-3{background:#e7f0ff;color:#2563eb}
.lc-task-empty{padding:48px 16px;text-align:center;font:400 13px/22px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-matrix{flex:1 1 auto;display:flex;flex-direction:column;width:100%;min-width:0;height:100%;background:var(--td-bg-color-container)}
.lc-matrix-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:15px 24px;background:var(--lc-brand);color:#fff;-webkit-app-region:drag;app-region:drag;user-select:none;-webkit-user-select:none}
.lc-matrix-head-title h2{margin:0;font:600 18px/26px var(--td-font-family);color:#fff}
.lc-matrix-head-title p{margin:3px 0 0;font:400 12px/18px var(--td-font-family);color:rgba(255,255,255,.72)}
.lc-matrix-head-stats{display:flex;align-items:center;gap:18px;flex-wrap:wrap;font:400 12px/20px var(--td-font-family);color:rgba(255,255,255,.82);-webkit-app-region:no-drag;app-region:no-drag}
.lc-matrix-head-stats b{font:600 15px/20px var(--td-font-family);color:#fff;font-variant-numeric:tabular-nums}
.lc-matrix-head-stats .is-danger b{color:#ffd8d2}
.lc-matrix-body{position:relative;flex:1 1 auto;min-width:0;min-height:0;display:flex;gap:14px;padding:20px 24px 28px;overflow:hidden}
.lc-matrix-grid{flex:1 1 auto;min-width:0;min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));gap:14px}
.lc-matrix-task[draggable='true']{cursor:grab}
.lc-matrix-task-dragging{opacity:.45}
.lc-matrix-card.is-drop-target{outline:2px solid var(--td-brand-color);outline-offset:-2px}
.lc-matrix-card.is-drop-target .lc-matrix-empty{color:var(--td-brand-color)}
.lc-matrix-card{display:flex;flex-direction:column;min-width:0;min-height:0;padding:13px 15px 9px;border:1px solid var(--td-component-stroke);border-left:3px solid #8b8b8b;border-radius:12px;background:var(--td-bg-color-container);box-shadow:0 1px 2px rgba(15,23,42,.04),0 6px 18px rgba(15,23,42,.07);overflow:hidden}
.lc-matrix-q1{border-left-color:#d54941;background:linear-gradient(150deg,#fff7f5 0%,var(--td-bg-color-container) 42%)}
.lc-matrix-q2{border-left-color:var(--lc-brand);background:linear-gradient(150deg,#f4f8ff 0%,var(--td-bg-color-container) 42%)}
.lc-matrix-q3{border-left-color:#e37318;background:linear-gradient(150deg,#fff9f3 0%,var(--td-bg-color-container) 42%)}
.lc-matrix-q4{border-left-color:#8b8b8b}
.lc-matrix-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:0 0 auto}
.lc-matrix-card-title h3{margin:0;font:600 14px/21px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-matrix-card-title p{margin:1px 0 0;font:400 10.5px/15px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-matrix-count{display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:22px;padding:0 7px;border-radius:7px;background:var(--td-bg-color-page);color:var(--td-text-color-secondary);font:600 11.5px/22px var(--td-font-family);font-variant-numeric:tabular-nums}
.lc-matrix-q1 .lc-matrix-count{background:#fff0ed;color:#d54941}
.lc-matrix-q2 .lc-matrix-count{background:var(--lc-brand-soft);color:var(--lc-brand)}
.lc-matrix-q3 .lc-matrix-count{background:#fff1e9;color:#c05a12}
.lc-matrix-q4 .lc-matrix-count{background:#f2f2f2;color:#777}
.lc-matrix-list{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:3px;margin-top:8px;padding-right:2px}
.lc-matrix-task{display:flex;align-items:flex-start;gap:9px;padding:7px 8px;border:1px solid transparent;border-radius:8px;cursor:pointer;transition:background .12s,border-color .12s}
.lc-matrix-task:hover{background:var(--td-bg-color-container-hover)}
.lc-matrix-task.is-selected{background:var(--td-brand-color-light);border-color:rgba(var(--lc-brand-rgb),.28)}
.lc-matrix-task.is-overdue .lc-matrix-task-date{color:var(--td-error-color)}
.lc-matrix-task .lc-task-check{margin-top:2px}
.lc-matrix-task-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.lc-matrix-task-title{font:400 12.5px/19px var(--td-font-family);color:var(--td-text-color-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-matrix-task-meta{display:flex;align-items:center;gap:7px;min-width:0;font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-matrix-manual{font:500 9px/14px var(--td-font-family);padding:0 5px;border-radius:999px;border:1px solid var(--td-component-stroke);background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-secondary);white-space:nowrap}
.lc-matrix-task-date{font-variant-numeric:tabular-nums;white-space:nowrap}
.lc-matrix-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1 1 auto;min-height:44px;font:400 12px/20px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-matrix-empty small{margin-top:2px;font:400 11px/17px var(--td-font-family);color:var(--td-text-color-placeholder);opacity:.75}
.lc-matrix-aside{flex:0 0 360px;min-width:0;min-height:0;border-radius:12px;overflow:hidden;border:1px solid var(--td-component-stroke)}
.lc-matrix-aside .lc-day-detail{height:100%;padding:16px}
body[data-ds-dark-theme] .lc-root .lc-matrix-head{background:var(--lc-brand-deep)}
body[data-ds-dark-theme] .lc-root .lc-matrix-q1{background:linear-gradient(150deg,#2a1f21 0%,var(--td-bg-color-container) 52%)}
body[data-ds-dark-theme] .lc-root .lc-matrix-q2{background:linear-gradient(150deg,#1c2637 0%,var(--td-bg-color-container) 52%)}
body[data-ds-dark-theme] .lc-root .lc-matrix-q3{background:linear-gradient(150deg,#2b231d 0%,var(--td-bg-color-container) 52%)}
body[data-ds-dark-theme] .lc-root .lc-matrix-card{box-shadow:0 1px 2px rgba(0,0,0,.32),0 8px 22px rgba(0,0,0,.24);border-color:rgba(255,255,255,.08)}
body[data-ds-dark-theme] .lc-root .lc-matrix-q4{background:var(--td-bg-color-container)}
body[data-ds-dark-theme] .lc-root .lc-matrix-q1 .lc-matrix-count{background:rgba(213,73,65,.18);color:#ff9b93}
body[data-ds-dark-theme] .lc-root .lc-matrix-q2 .lc-matrix-count{background:rgba(var(--lc-brand-rgb),.2);color:var(--lc-brand-light)}
body[data-ds-dark-theme] .lc-root .lc-matrix-q3 .lc-matrix-count{background:rgba(227,115,24,.2);color:#ffb37c}
body[data-ds-dark-theme] .lc-root .lc-matrix-q4 .lc-matrix-count{background:rgba(255,255,255,.1);color:rgba(255,255,255,.6)}
@media (max-width:980px){
.lc-matrix-body{padding:12px;gap:10px;overflow:auto}
.lc-matrix-grid{grid-template-columns:minmax(0,1fr);grid-template-rows:none;min-height:auto;gap:10px}
.lc-matrix-card{min-height:0;overflow:visible}
.lc-matrix-list{flex:0 0 auto;overflow:visible}
.lc-matrix-aside{position:absolute;z-index:8;right:12px;top:12px;bottom:12px;width:min(360px,calc(100% - 24px));box-shadow:var(--td-shadow-2)}
}
@media (max-width:720px){
.lc-matrix-head{padding:12px 14px;gap:9px}
.lc-matrix-head-title h2{font-size:16px;line-height:24px}
.lc-matrix-head-title p{display:none}
.lc-matrix-head-stats{gap:12px;font-size:11px}
.lc-matrix-head-stats b{font-size:13px}
.lc-matrix-body{padding:10px}
.lc-matrix-card{min-height:0;padding:11px 12px 8px}
.lc-matrix-aside{right:10px;top:10px;bottom:10px;width:min(360px,calc(100% - 20px))}
}
.lc-summary{flex:1 1 0%;display:flex;flex-direction:column;width:100%;min-width:0;height:100%;background:var(--td-bg-color-page,#f4f5f7)}
.lc-summary-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:15px 24px;background:var(--lc-brand);color:#fff;-webkit-app-region:drag;app-region:drag;user-select:none;-webkit-user-select:none}
.lc-summary-head-title h2{margin:0;font:600 18px/26px var(--td-font-family);color:#fff}
.lc-summary-head-title p{margin:3px 0 0;font:400 12px/18px var(--td-font-family);color:rgba(255,255,255,.72)}
.lc-summary-head-controls{display:flex;align-items:center;gap:14px;flex-wrap:wrap;-webkit-app-region:no-drag;app-region:no-drag}
.lc-sum-modes{display:flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:rgba(255,255,255,.16)}
.lc-sum-mode-btn{height:28px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:rgba(255,255,255,.84);font:500 12px/28px var(--td-font-family);cursor:pointer;transition:background .12s,color .12s}
.lc-sum-mode-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.lc-sum-mode-btn.is-active{background:#fff;color:var(--lc-brand);font-weight:600}
.lc-sum-nav{display:flex;align-items:center;gap:4px}
.lc-sum-nav-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;border-radius:7px;background:transparent;color:rgba(255,255,255,.9);cursor:pointer}
.lc-sum-nav-btn:hover{background:rgba(255,255,255,.16);color:#fff}
.lc-sum-range{min-width:196px;text-align:center;font:600 12.5px/20px var(--td-font-family);color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.lc-sum-today-btn{height:30px;padding:0 12px;border:1px solid rgba(255,255,255,.4);border-radius:7px;background:transparent;color:#fff;font:500 12px/28px var(--td-font-family);cursor:pointer;white-space:nowrap}
.lc-sum-today-btn:hover{background:rgba(255,255,255,.16)}
.lc-summary-body{flex:1 1 auto;min-height:0;overflow:auto;padding:22px 24px 40px}
.lc-summary-inner{width:100%;max-width:none;margin:0;display:flex;flex-direction:column;gap:16px}
.lc-sum-error{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-radius:9px;background:var(--td-error-color-light);color:var(--td-error-color);font:400 12px/18px var(--td-font-family)}
.lc-sum-error button{height:26px;padding:0 10px;border:0;border-radius:6px;background:var(--td-error-color);color:#fff;font:500 12px/26px var(--td-font-family);cursor:pointer}
.lc-sum-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.lc-sum-metric{display:flex;flex-direction:column;gap:1px;min-width:0;padding:13px 16px;border:1px solid var(--td-component-stroke);border-left:3px solid var(--td-brand-color);border-radius:10px;background:var(--td-bg-color-container)}
.lc-sum-metric-label{font:400 11.5px/18px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-sum-metric-value{font:600 25px/32px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums}
.lc-sum-metric-sub{font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-sum-metric-success{border-left-color:var(--td-success-color)}
.lc-sum-metric-success .lc-sum-metric-value{color:var(--td-success-color)}
.lc-sum-metric-warning{border-left-color:var(--td-warning-color)}
.lc-sum-metric-warning .lc-sum-metric-value{color:var(--td-warning-color)}
.lc-sum-metric-muted{border-left-color:var(--td-component-stroke)}
.lc-sum-focus{border-left:3px solid #ef8a7e;background:linear-gradient(160deg,#fff8f5 0%,var(--td-bg-color-container) 46%)}
.lc-sum-focus-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.lc-sum-focus-title{display:flex;align-items:center;gap:9px;min-width:0}
.lc-sum-focus-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 32px;width:32px;height:32px;border-radius:9px;background:#fff0ed;font-size:18px;line-height:1}
.lc-sum-focus-title h3{margin:0;font:600 15px/22px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-sum-focus-title p{margin:1px 0 0;font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-focus-total{display:flex;align-items:baseline;gap:4px;flex:0 0 auto;white-space:nowrap}
.lc-sum-focus-total strong{font:600 27px/1 var(--td-font-family);color:#d54941;font-variant-numeric:tabular-nums}
.lc-sum-focus-total span{font:400 11px/1 var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-sum-focus-total em{margin-left:8px;font:400 11px/1 var(--td-font-family);color:var(--td-text-color-placeholder);font-style:normal;font-variant-numeric:tabular-nums}
.lc-sum-focus-body{display:flex;align-items:flex-end;gap:26px;margin-top:12px;padding-top:13px;border-top:1px solid #f6e7e3}
.lc-sum-focus-stats{display:flex;gap:26px;flex:0 0 auto}
.lc-sum-focus-stats span{display:block;font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-focus-stats b{display:block;margin-top:2px;font:600 14px/20px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums;white-space:nowrap}
.lc-sum-focus-chart{display:flex;align-items:flex-end;gap:4px;flex:1 1 auto;height:66px;min-width:0}
.lc-sum-focus-col{display:flex;flex-direction:column;justify-content:flex-end;height:100%;flex:1 1 0;min-width:2px;gap:5px}
.lc-sum-focus-bar{flex:1 1 auto;display:flex;align-items:flex-end;min-height:0}
.lc-sum-focus-bar i{display:block;width:100%;min-height:2px;border-radius:3px 3px 2px 2px;background:#f3c1ba;transition:height .2s ease}
.lc-sum-focus-col.is-active .lc-sum-focus-bar i{background:linear-gradient(180deg,#f29a8f,#d54941)}
.lc-sum-focus-day{height:12px;font:400 9px/12px var(--td-font-family);text-align:center;color:var(--td-text-color-placeholder);overflow:hidden;font-variant-numeric:tabular-nums}
.lc-sum-focus-tasks{display:flex;flex-direction:column;gap:5px;flex:1 1 auto;min-width:0}
.lc-sum-focus-body.is-day .lc-sum-focus-tasks{flex:0 1 520px;max-width:520px}
.lc-sum-focus-body.is-day .lc-sum-focus-task{justify-content:flex-start;gap:14px}
.lc-sum-focus-body.is-day .lc-sum-focus-task-title{max-width:360px}
.lc-sum-focus-task{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px dashed #f0dcd7;font:400 11.5px/18px var(--td-font-family)}
.lc-sum-focus-task:first-child{border-top:0}
.lc-sum-focus-task-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--td-text-color-primary)}
.lc-sum-focus-task-meta{flex:0 0 auto;color:var(--td-text-color-secondary);font-variant-numeric:tabular-nums}
.lc-sum-focus-empty{padding:12px 0 2px;font:400 12px/18px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-focus-empty.is-error{color:var(--td-error-color)}
.lc-sum-focus-empty button{margin-left:8px;height:22px;padding:0 8px;border:0;border-radius:5px;background:var(--td-error-color-light);color:var(--td-error-color);font:500 10.5px/22px var(--td-font-family);cursor:pointer}
.lc-sum-focus-line{margin:8px 0 0;font:500 12px/1.7 var(--td-font-family);color:#c4584b}
.lc-sum-content{margin:12px 0 2px;padding:9px 11px;border:1px solid #e3ecfb;border-radius:8px;background:#f7faff}
.lc-sum-content-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:5px;flex-wrap:wrap}
.lc-sum-content-head span{font:600 11.5px/18px var(--td-font-family);color:var(--td-brand-color);letter-spacing:.02em}
.lc-sum-content-head em{font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder);font-style:normal;text-align:right}
.lc-sum-content p{margin:3px 0;font:400 11.5px/1.72 var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-sum-content p b{display:inline-block;min-width:42px;margin-right:5px;font-weight:600;color:var(--td-text-color-primary)}
.lc-sum-content p.is-dropped{opacity:.72}
.lc-sum-day-focus{display:block;margin-top:2px;text-align:right;font:500 10px/16px var(--td-font-family);color:#c4584b;font-variant-numeric:tabular-nums}
.lc-summary-grid{display:grid;width:100%;min-width:0;grid-template-columns:minmax(0,1.18fr) minmax(360px,.82fr);gap:16px;align-items:start}
.lc-summary,.lc-summary-inner,.lc-summary-grid{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box}
.lc-sum-card{min-width:0;padding:18px;border:1px solid var(--td-component-stroke);border-radius:12px;background:var(--td-bg-color-container)}
.lc-sum-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:12px}
.lc-sum-card-head h3{margin:0;font:600 15px/23px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-sum-card-head p{margin:2px 0 0;font:400 11.5px/18px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-card-badge{flex:0 0 auto;height:22px;padding:0 8px;border-radius:6px;background:var(--td-brand-color-light);color:var(--td-brand-color);font:500 11px/22px var(--td-font-family);white-space:nowrap}
.lc-sum-day{padding:12px 0;border-top:1px solid var(--td-component-stroke)}
.lc-sum-day:first-of-type{border-top:0;padding-top:2px}
.lc-sum-day-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.lc-sum-day-date{display:flex;align-items:baseline;gap:6px;min-width:0}
.lc-sum-day-date b{font:600 13px/20px var(--td-font-family);color:var(--td-text-color-primary);font-variant-numeric:tabular-nums}
.lc-sum-day-date span{font:400 11px/18px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-day-date em{height:17px;padding:0 5px;border-radius:4px;background:var(--td-brand-color-light);color:var(--td-brand-color);font:500 10px/17px var(--td-font-family);font-style:normal}
.lc-sum-day-count{flex:0 0 auto;font:400 11px/18px var(--td-font-family);color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-sum-day-bar{height:4px;margin:7px 0 9px;border-radius:2px;background:var(--td-bg-color-secondarycontainer);overflow:hidden}
.lc-sum-day-bar i{display:block;height:100%;border-radius:2px;background:var(--td-brand-color);transition:width .25s ease}
.lc-sum-day-bar i.is-full{background:var(--td-success-color)}
.lc-sum-tasks{display:flex;flex-wrap:wrap;gap:5px}
.lc-sum-task{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 7px;border:1px solid var(--td-component-stroke);border-radius:6px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:400 11.5px/18px var(--td-font-family);text-align:left;cursor:pointer;transition:background .12s,border-color .12s}
.lc-sum-task:hover{background:var(--td-bg-color-container-hover);border-color:var(--td-brand-color)}
.lc-sum-task-dot{flex:0 0 5px;width:5px;height:5px;border-radius:50%;background:var(--td-text-color-placeholder)}
.lc-sum-task.is-done .lc-sum-task-dot{background:var(--td-success-color)}
.lc-sum-task.is-open .lc-sum-task-dot{background:var(--td-brand-color)}
.lc-sum-task.is-dropped{opacity:.62}
.lc-sum-task.is-dropped .lc-sum-task-dot{background:var(--td-text-color-disabled)}
.lc-sum-task.is-dropped .lc-sum-task-title{text-decoration:line-through}
.lc-sum-task-title{min-width:0;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-sum-task-pri{flex:0 0 auto;font:600 9px/14px var(--td-font-family);color:var(--td-error-color)}
.lc-sum-more{align-self:center;font:400 10.5px/18px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-day-none{font:400 11px/18px var(--td-font-family);color:var(--td-text-color-disabled)}
.lc-sum-day-empty .lc-sum-day-date,.lc-sum-day-empty .lc-sum-day-count{opacity:.58}
.lc-sum-day-empty .lc-sum-day-bar{display:none}
.lc-sum-day-today{padding-left:10px;padding-right:10px;margin:0 -10px;border-radius:8px;background:linear-gradient(90deg,rgba(var(--lc-brand-rgb),.07),rgba(var(--lc-brand-rgb),0))}
.lc-sum-day-today .lc-sum-day-date b{color:var(--td-brand-color)}
.lc-sum-empty{padding:36px 10px;text-align:center;font:400 12.5px/20px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-ai{border-color:#dbe5fb;background:linear-gradient(155deg,#f6f9ff 0%,var(--td-bg-color-container) 52%)}
.lc-sum-ai-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.lc-sum-ai-title{display:flex;align-items:center;gap:9px;min-width:0}
.lc-sum-ai-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 30px;width:30px;height:30px;border-radius:9px;background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-sum-ai-title h3{margin:0;font:600 15px/22px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-sum-ai-title p{margin:1px 0 0;font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-ai-actions{display:flex;align-items:center;gap:2px;flex:0 0 auto}
.lc-sum-ai-actions button{height:26px;padding:0 7px;border:0;border-radius:6px;background:transparent;color:var(--td-brand-color);font:500 11px/26px var(--td-font-family);cursor:pointer;white-space:nowrap}
.lc-sum-ai-actions button:hover{background:var(--td-brand-color-light)}
.lc-sum-opening{margin:14px 0 4px;font:400 13px/1.85 var(--td-font-family);color:var(--td-text-color-primary)}
.lc-sum-kiss{margin-top:4px}
.lc-kiss{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;padding:11px 0;border-top:1px solid #edf2fc}
.lc-kiss-badge{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;font:700 11px/1 var(--td-font-family)}
.lc-kiss-keep .lc-kiss-badge{background:var(--td-success-color-light);color:var(--td-success-color)}
.lc-kiss-improve .lc-kiss-badge{background:var(--td-warning-color-light);color:var(--td-warning-color)}
.lc-kiss-start .lc-kiss-badge{background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-kiss-stop .lc-kiss-badge{background:#f1f1f1;color:#777}
.lc-kiss-title{font:600 12.5px/20px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-kiss-title span{margin-left:5px;font:400 9.5px/1 var(--td-font-family);color:var(--td-text-color-placeholder);letter-spacing:.02em}
.lc-kiss-list{margin:3px 0 0;padding-left:15px}
.lc-kiss-list li{margin:1px 0;font:400 12.5px/1.75 var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-kiss-list li::marker{color:var(--td-text-color-placeholder)}
.lc-sum-closing{margin:12px 0 0;padding:10px 12px;border-radius:8px;background:#f5f8ff;color:var(--td-text-color-secondary);font:400 12px/1.75 var(--td-font-family)}
.lc-sum-disclaimer{margin:9px 0 0;font:400 10px/16px var(--td-font-family);color:var(--td-text-color-disabled)}
.lc-sum-note{border-left:3px solid var(--td-brand-color);background:linear-gradient(160deg,#f7faff 0%,var(--td-bg-color-container) 46%)}
.lc-sum-note-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:12px}
.lc-sum-note-title{display:flex;align-items:center;gap:9px;min-width:0}
.lc-sum-note-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 30px;width:30px;height:30px;border-radius:9px;background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-sum-note-title h3{margin:0;font:600 15px/22px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-sum-note-title p{margin:1px 0 0;font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-note-state{flex:0 0 auto;height:22px;padding:0 8px;border-radius:6px;background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-placeholder);font:500 10.5px/22px var(--td-font-family);white-space:nowrap}
.lc-sum-note-state.is-saving{background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-sum-note-state.is-saved{background:var(--td-success-color-light);color:var(--td-success-color)}
.lc-sum-note-state.is-error{background:var(--td-error-color-light);color:var(--td-error-color)}
.lc-sum-note-input{display:block;width:100%;min-height:156px;max-height:360px;resize:vertical;padding:13px 14px;border:1px solid var(--td-component-stroke);border-radius:9px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:400 13px/1.9 var(--td-font-family);outline:none;transition:border-color .15s,box-shadow .15s}
.lc-sum-note-input:focus{border-color:var(--td-brand-color);box-shadow:0 0 0 3px var(--td-brand-color-focus)}
.lc-sum-note-input::placeholder{color:var(--td-text-color-placeholder)}
.lc-sum-note-input:disabled{opacity:.62;cursor:wait}
.lc-sum-note-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;font:400 10.5px/16px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-sum-note-hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-sum-note-hint.is-error{color:var(--td-error-color)}
.lc-sum-note-meta{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;font-variant-numeric:tabular-nums}
.lc-sum-note-retry{height:22px;padding:0 7px;border:0;border-radius:5px;background:var(--td-error-color-light);color:var(--td-error-color);font:500 10.5px/22px var(--td-font-family);cursor:pointer}
body[data-ds-dark-theme] .lc-root .lc-summary{background:#151515}
body[data-ds-dark-theme] .lc-root .lc-summary-head{background:var(--lc-brand-deep)}
body[data-ds-dark-theme] .lc-root .lc-sum-metric,body[data-ds-dark-theme] .lc-root .lc-sum-card{background:var(--td-bg-color-container);border-color:#333}
body[data-ds-dark-theme] .lc-root .lc-sum-ai{border-color:#2f3d58;background:linear-gradient(155deg,#1b2434 0%,var(--td-bg-color-container) 55%)}
body[data-ds-dark-theme] .lc-root .lc-sum-content{border-color:#2c3a52;background:#1a2230}
body[data-ds-dark-theme] .lc-root .lc-sum-day,body[data-ds-dark-theme] .lc-root .lc-kiss{border-top-color:#333}
body[data-ds-dark-theme] .lc-root .lc-sum-closing{background:#1e2636}
body[data-ds-dark-theme] .lc-root .lc-sum-note{border-left-color:#4d85ff;background:linear-gradient(160deg,#1b2434 0%,var(--td-bg-color-container) 46%)}
body[data-ds-dark-theme] .lc-root .lc-sum-note-input{background:#1b1b1b;border-color:#3a3a3a;color:#eee}
body[data-ds-dark-theme] .lc-root .lc-sum-note-input:focus{border-color:#4d85ff}
body[data-ds-dark-theme] .lc-root .lc-sum-focus{border-left-color:#f08a7e;background:linear-gradient(160deg,#2a1e1c 0%,var(--td-bg-color-container) 46%)}
body[data-ds-dark-theme] .lc-root .lc-sum-focus-icon{background:#3a2622}
body[data-ds-dark-theme] .lc-root .lc-sum-focus-total strong,body[data-ds-dark-theme] .lc-root .lc-sum-focus-line,body[data-ds-dark-theme] .lc-root .lc-sum-day-focus{color:#ff9a8e}
body[data-ds-dark-theme] .lc-root .lc-sum-focus-body{border-top-color:#3a2a26}
body[data-ds-dark-theme] .lc-root .lc-sum-focus-bar i{background:#5a3a34}
body[data-ds-dark-theme] .lc-root .lc-sum-focus-col.is-active .lc-sum-focus-bar i{background:linear-gradient(180deg,#ff9a8e,#ff7a6b)}
body[data-ds-dark-theme] .lc-root .lc-sum-focus-task{border-top-color:#3a2a26}
body[data-ds-dark-theme] .lc-root .lc-sum-day-focus{background:transparent}
body[data-ds-dark-theme] .lc-root .lc-kiss-stop .lc-kiss-badge{background:#2c2c2c;color:#aaa}
body[data-ds-dark-theme] .lc-root .lc-sum-task{background:#282828;border-color:#3a3a3a}
body[data-ds-dark-theme] .lc-root .lc-sum-task:hover{background:#303030;border-color:#4d85ff}
body[data-ds-dark-theme] .lc-root .lc-sum-mode-btn.is-active{background:#fff;color:var(--lc-brand-deep)}
@media (max-width:900px){
.lc-summary-grid{grid-template-columns:minmax(0,1fr)}
.lc-sum-range{min-width:170px}
.lc-sum-focus-body{flex-direction:column;align-items:stretch;gap:12px}
.lc-sum-focus-stats{justify-content:space-between;gap:12px}
.lc-sum-focus-chart{height:58px}
}
@media (max-width:720px){
.lc-summary-head{padding:12px 14px;gap:10px}
.lc-summary-head-title h2{font-size:16px;line-height:24px}
.lc-summary-head-title p{display:none}
.lc-summary-head-controls{width:100%;gap:8px}
.lc-sum-modes{flex:0 0 auto}
.lc-sum-mode-btn{height:26px;padding:0 9px;font-size:11px;line-height:26px}
.lc-sum-nav{flex:1 1 100%;justify-content:space-between}
.lc-sum-range{flex:1 1 auto;min-width:0;font-size:11.5px}
.lc-sum-today-btn{display:none}
.lc-summary-body{padding:12px}
.lc-sum-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.lc-sum-metric{padding:10px 12px}
.lc-sum-metric-value{font-size:21px;line-height:28px}
.lc-sum-card{padding:13px;border-radius:10px}
.lc-sum-task-title{max-width:200px}
}
@media (max-width:1180px){
.lc-task-main{padding:20px 20px 32px}
}
@media (max-width:980px){
.lc-tasks{grid-template-columns:var(--lc-side-w,190px) 5px minmax(0,1fr);position:relative}
.lc-tasks>.lc-split:nth-of-type(2){display:none}
.lc-tasks .lc-day-detail{position:absolute;top:0;right:0;bottom:0;z-index:5;width:min(320px,82%);display:flex;box-shadow:-8px 0 24px rgba(0,0,0,.12)}
.lc-tasks .lc-day-detail-empty{display:none}
}
body[data-ds-dark-theme] .lc-root .lc-nav-btn-active,
body[data-ds-dark-theme] .lc-root .lc-nav-btn-active:hover,
body[data-ds-dark-theme] .lc-root .lc-task-side-item-active,
body[data-ds-dark-theme] .lc-root .lc-task-side-item-active:hover,
body[data-ds-dark-theme] .lc-root .lc-task-row-active,
body[data-ds-dark-theme] .lc-root .lc-task-row-active:hover{background:rgba(77,133,255,.18);color:#8ab4ff}
body[data-ds-dark-theme] .lc-root .lc-task-side-item-active .lc-task-side-icon,
body[data-ds-dark-theme] .lc-root .lc-task-side-item-active .lc-task-side-count{color:#8ab4ff}
body[data-ds-dark-theme] .lc-root .lc-task-row-active .lc-task-row-title{color:var(--td-text-color-primary)}
body[data-ds-dark-theme] .lc-root .lc-nav{background:var(--lc-brand-deep)}
body[data-ds-dark-theme] .lc-root .lc-nav-btn{color:rgba(255,255,255,.86)}
body[data-ds-dark-theme] .lc-root .lc-nav-btn:hover{background:rgba(255,255,255,.16);color:#fff}
body[data-ds-dark-theme] .lc-root .lc-nav-btn-active,
body[data-ds-dark-theme] .lc-root .lc-nav-btn-active:hover{background:#fff;color:var(--lc-brand-deep)}
@media (max-width:720px){
.lc-tasks{grid-template-columns:var(--lc-side-w,170px) minmax(0,1fr)}
.lc-tasks>.lc-split{display:none}
.lc-nav{flex-basis:62px;width:62px;padding:57px 0 12px}
.lc-nav-btn{width:52px;height:54px;font-size:10px}
.lc-tasks{grid-template-columns:150px minmax(0,1fr)}
.lc-task-side{padding:14px 8px}
.lc-task-main{padding:16px 14px 28px}
@media (max-width:720px){
.lc-page{padding:0}
.lc-field-row{grid-template-columns:1fr}
.lc-batch-rows .lc-batch-row{flex-wrap:wrap}
.lc-batch-date{flex:1 1 130px!important}
}
}
/* ── 设置页 ───────────────────────────────────────────────────────────── */
.lc-nav-settings{margin-top:auto}
.lc-nav-update{margin-top:0}
.lc-nav-version{flex:0 0 auto;margin-top:7px;width:100%;text-align:center;font-size:9px;line-height:1.1;letter-spacing:.02em;color:rgba(255,255,255,.58);user-select:none;pointer-events:none}
.lc-settings{flex:1 1 0%;display:flex;flex-direction:column;min-width:0;height:100%;background:var(--td-bg-color-page);overflow:hidden}
.lc-settings-head{flex:0 0 auto;padding:18px 26px 15px;background:var(--lc-brand);color:#fff;-webkit-app-region:drag}
.lc-settings-title{margin:0;font-size:17px;font-weight:600;line-height:1.3}
.lc-settings-sub{margin:4px 0 0;font-size:12px;opacity:.78}
.lc-settings-body{flex:1 1 auto;min-height:0;overflow:auto;padding:18px 22px 30px;display:flex;flex-direction:column;gap:14px;width:100%;box-sizing:border-box}
.lc-settings-card{background:var(--td-bg-color-container);border:1px solid var(--td-component-stroke);border-radius:10px;padding:17px 19px;box-sizing:border-box;width:100%}
.lc-settings-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
.lc-settings-card-title{margin:0;font-size:14px;font-weight:600;line-height:1.4}
.lc-settings-card-sub{margin:4px 0 0;font-size:12px;color:var(--td-text-color-secondary);line-height:1.5}
.lc-settings-sync-row{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}
.lc-settings-range{display:flex;align-items:flex-end;gap:12px;margin-top:14px;flex-wrap:wrap}
.lc-settings-range-field{display:flex;flex-direction:column;gap:6px}
.lc-settings-range-label{font-size:11px;color:var(--td-text-color-secondary)}
.lc-settings-select{height:34px;min-width:116px;padding:0 30px 0 11px;border:1px solid var(--td-component-stroke);border-radius:7px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:inherit;font-size:13px;cursor:pointer}
.lc-settings-select:focus{outline:none;border-color:var(--lc-brand);box-shadow:0 0 0 2px rgba(var(--lc-brand-rgb),.16)}
.lc-settings-range-sep{font-size:12px;color:var(--td-text-color-placeholder);padding-bottom:9px}
.lc-settings-range-summary{font-size:12px;color:var(--td-text-color-secondary);padding-bottom:9px;margin-left:2px}
body[data-ds-dark-theme] .lc-settings-select{background:var(--td-bg-color-container);border-color:var(--td-component-stroke)}
@media (max-width:720px){
.lc-settings-range{gap:10px}
.lc-settings-select{min-width:104px}
}
.lc-settings-status{font-size:12px;font-weight:500;color:var(--td-text-color-primary)}
.lc-settings-status.is-error{color:var(--td-error-color)}
.lc-settings-time{font-size:11px;color:var(--td-text-color-placeholder)}
.lc-settings-sync-btn{margin-left:auto}
.lc-settings-error{margin:9px 0 0;font-size:12px;line-height:1.6;color:var(--td-error-color);background:var(--td-error-color-light);border-radius:6px;padding:8px 10px}
.lc-settings-calendars{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.lc-settings-calendar{font-size:11px;color:var(--td-text-color-secondary);background:var(--td-bg-color-secondarycontainer);border-radius:999px;padding:3px 9px}
.lc-settings-note{margin:10px 0 0;font-size:12px;line-height:1.65;color:var(--td-text-color-secondary)}
.lc-settings-card > .lc-settings-card-title + .lc-settings-note{margin-top:6px}

/* 本机日历事件（只读） */
.lc-cal-event{display:flex;align-items:center;gap:4px;height:19px;min-width:0;padding:0 5px;border-radius:4px;background:var(--td-bg-color-secondarycontainer);border-left:2px solid #9aa4b2;color:var(--td-text-color-secondary);font-size:11px;line-height:19px;cursor:default;flex:0 0 auto;box-sizing:border-box}
.lc-cal-event-time{font-size:10px;color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums;flex:0 0 auto}
.lc-cal-event-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-cal-tasks-month .lc-cal-event{height:18px;line-height:18px;font-size:10.5px}
.lc-cal-sync{display:inline-flex;align-items:center;gap:5px;max-width:100%;margin-left:9px;padding:0;border:0;background:transparent;color:rgba(255,255,255,.78);font:500 11px/1.35 var(--td-font-family);cursor:pointer;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-app-region:no-drag}
.lc-cal-sync:hover{color:#fff}
.lc-cal-sync-dot{width:6px;height:6px;border-radius:50%;background:#7ee2b8;flex:0 0 auto}
.lc-cal-sync-error .lc-cal-sync-dot{background:#ffb4ab}
.lc-day-event-external{background:var(--td-bg-color-secondarycontainer);border-left:3px solid #8a94a6;color:var(--td-text-color-secondary);cursor:default;box-shadow:none}
.lc-day-event-external:hover{background:var(--td-bg-color-secondarycontainer-hover);box-shadow:none}
.lc-day-event-dot{width:6px;height:6px;border-radius:50%;background:#8a94a6;flex:0 0 auto}
.lc-day-event-source{display:block;font-size:10px;line-height:1.2;color:var(--td-text-color-placeholder);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.lc-day-event-external .lc-day-event-title{font-weight:500}
body[data-ds-dark-theme] .lc-settings-card{background:var(--td-bg-color-container);border-color:var(--td-component-stroke)}
body[data-ds-dark-theme] .lc-cal-event{background:rgba(255,255,255,.06);border-left-color:#8d98a8}
body[data-ds-dark-theme] .lc-day-event-external{background:rgba(255,255,255,.06);border-left-color:#8d98a8}
@media (max-width: 720px){.lc-settings-head{padding:14px 16px 12px}.lc-settings-body{padding:14px 12px 24px}.lc-settings-card{padding:14px 14px}.lc-settings-sync-btn{margin-left:0}}

/* 统一页面顶部标题栏：尺寸参考日历页，底部圆角 */
.lc-cal-head,.lc-task-top,.lc-board-head,.lc-summary-head,.lc-matrix-head,.lc-pomo-head,.lc-settings-head{min-height:69px;padding:14px 16px;border-radius:0 0 12px 12px;box-sizing:border-box;border-bottom:0;flex-shrink:0}
/* 每个页面的内容区顶部圆角，与日历白底一致：蓝色页头/页面底色从圆角处露出 */
.lc-task-page,.lc-board,.lc-summary,.lc-pomo-page,.lc-matrix,.lc-settings{background:var(--lc-brand)}
.lc-tasks,.lc-board-body,.lc-summary-body,.lc-pomo-body,.lc-matrix-body,.lc-settings-body{border-radius:12px 12px 0 0}
.lc-tasks,.lc-matrix-body{background:var(--td-bg-color-container)}
.lc-board-body,.lc-summary-body,.lc-pomo-body,.lc-settings-body{background:var(--td-bg-color-page,#f4f5f7)}
.lc-cal-title,.lc-task-top-title,.lc-board-title,.lc-summary-head-title h2,.lc-matrix-head-title h2,.lc-pomo-head-title h1,.lc-settings-title{font:600 14px/20px var(--td-font-family);letter-spacing:0;margin:0}
.lc-cal-sub,.lc-task-top-sub,.lc-board-sub,.lc-summary-head-title p,.lc-matrix-head-title p,.lc-pomo-head-title p,.lc-settings-sub{margin:3px 0 0;font:400 12px/18px var(--td-font-family);color:rgba(255,255,255,.78);display:block}
.lc-settings-head{display:flex;flex-direction:column;justify-content:center}
@media (max-width:720px){
  .lc-cal-head,.lc-task-top,.lc-board-head,.lc-summary-head,.lc-matrix-head,.lc-pomo-head,.lc-settings-head{min-height:69px;padding:14px 14px;border-radius:0 0 10px 10px}
  .lc-cal-title,.lc-task-top-title,.lc-board-title,.lc-summary-head-title h2,.lc-matrix-head-title h2,.lc-pomo-head-title h1,.lc-settings-title{font-size:14px;line-height:20px}
  .lc-cal-sub,.lc-task-top-sub,.lc-board-sub,.lc-summary-head-title p,.lc-matrix-head-title p,.lc-pomo-head-title p,.lc-settings-sub{font-size:12px;line-height:18px;display:block}
}

/* DSH 左侧栏收起时，页头左侧标题区右移 100px，避开窗口左上角交通灯；右侧控件不动 */
:is(html,body):has([data-sidebar-collapsed]) .lc-cal-title-wrap,
:is(html,body):has([data-sidebar-collapsed]) .lc-task-top-main,
:is(html,body):has([data-sidebar-collapsed]) .lc-board-head-main,
:is(html,body):has([data-sidebar-collapsed]) .lc-summary-head-title,
:is(html,body):has([data-sidebar-collapsed]) .lc-matrix-head-title,
:is(html,body):has([data-sidebar-collapsed]) .lc-pomo-head-title,
:is(html,body):has([data-sidebar-collapsed]) .lc-settings-title,
:is(html,body):has([data-sidebar-collapsed]) .lc-settings-sub{margin-left:100px}

/* 任务分类 */
.lc-cat-card .lc-settings-card-head{align-items:center}
.lc-settings-cat-count{flex:0 0 auto;font:500 11px/22px var(--td-font-family);padding:0 8px;border-radius:6px;background:var(--td-brand-color-light);color:var(--td-brand-color)}
.lc-cat-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.lc-cat-row{display:grid;grid-template-columns:32px minmax(0,1fr) auto 32px;gap:10px;align-items:center;padding:6px 10px;border:1px solid var(--td-component-stroke);border-radius:8px;background:var(--td-bg-color-secondarycontainer)}
.lc-cat-row.is-busy{opacity:.6}
.lc-cat-color{width:32px;height:32px;padding:0;border:1px solid var(--td-component-stroke);border-radius:8px;background:transparent;cursor:pointer}
.lc-cat-color::-webkit-color-swatch-wrapper{padding:3px}
.lc-cat-color::-webkit-color-swatch{border:0;border-radius:5px}
.lc-cat-name{height:32px!important;min-width:0;background:var(--td-bg-color-container);border:1px solid var(--td-component-stroke);border-radius:6px;padding:0 10px;color:var(--td-text-color-primary)}
.lc-cat-name:focus{outline:none;border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-light)}
.lc-cat-count{font:400 11.5px/18px var(--td-font-family);color:var(--td-text-color-placeholder);white-space:nowrap}
.lc-cat-delete{color:var(--td-text-color-placeholder)}
.lc-cat-delete:hover{color:var(--td-error-color);background:var(--td-error-color-light)}
.lc-cat-add{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px dashed var(--td-component-stroke)}
.lc-link-btn{border:0;background:none;color:var(--td-brand-color);font:500 12px var(--td-font-family);cursor:pointer;padding:0 4px;margin-left:6px}
.lc-cat-dot{width:8px;height:8px;border-radius:50%;background:var(--lc-cat,#9aa3ad);flex:0 0 auto}
.lc-detail-category{padding-left:8px}
.lc-detail-cat-name{max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-batch-cat{display:flex;align-items:center;gap:6px;font:400 12px/18px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-batch-cat-select{width:104px;height:32px!important;padding:0 8px!important}
.lc-task-row-cat{box-shadow:inset 3px 0 0 var(--lc-cat)}
.lc-task-row-cat.lc-task-row-active{box-shadow:inset 3px 0 0 var(--lc-cat)}
.lc-cal-task-cat{background:var(--lc-cat-bg);box-shadow:inset 3px 0 0 var(--lc-cat)}
.lc-cal-task-cat .lc-cal-task-link,.lc-cal-task-cat .lc-cal-task-title{color:var(--td-text-color-primary)}
.lc-cal-task-cat.lc-cal-task-done{background:var(--lc-cat-bg)}
.lc-day-event-cat{background:var(--lc-cat-bg);border-left-color:var(--lc-cat)!important}
.lc-day-event-cat .lc-day-event-title{color:var(--td-text-color-primary)}
.lc-matrix-task-cat{box-shadow:none}
.lc-matrix-task-cat.is-selected{background:var(--td-brand-color-light)}
.lc-sum-slots-axis{display:grid;grid-template-columns:repeat(5,1fr);gap:0;margin:12px 0 0;font:400 10px/14px var(--td-font-family);color:var(--td-text-color-placeholder);font-variant-numeric:tabular-nums}
.lc-sum-slots-axis span:nth-child(2),.lc-sum-slots-axis span:nth-child(3),.lc-sum-slots-axis span:nth-child(4){text-align:center}
.lc-sum-slots-axis span:last-child{text-align:right}
.lc-sum-slots{display:grid;grid-template-columns:repeat(48,minmax(0,1fr));gap:2px;height:12px;margin:6px 0 4px}
.lc-sum-slot{min-width:0;border-radius:2px;background:#e8eaee;border:1px solid transparent;box-sizing:border-box}
.lc-sum-slot.is-filled{border-color:rgba(0,0,0,.05)}
.lc-sum-slot.is-done{opacity:.58}
body[data-ds-dark-theme] .lc-cat-row{background:var(--td-bg-color-secondarycontainer);border-color:var(--td-component-stroke)}
body[data-ds-dark-theme] .lc-sum-slot{background:#3a3a3a}
body[data-ds-dark-theme] .lc-sum-slot.is-filled{border-color:rgba(255,255,255,.08)}
@media (max-width:720px){
  .lc-cat-row{grid-template-columns:32px minmax(0,1fr) 32px;gap:8px;padding:7px 8px}
  .lc-cat-count{display:none}
  .lc-cat-color{width:32px;height:32px}
  .lc-cat-add{grid-template-columns:32px minmax(0,1fr) auto;gap:8px}
  .lc-batch-cat{margin-left:auto}
  .lc-sum-slots{gap:1px;height:10px}
  .lc-detail-cat-name{max-width:48px}
}

/* 滚动条平时透明，滚动时出现并在停止后自动隐藏。 */
.lc-root,.lc-root *{scrollbar-width:thin;scrollbar-color:transparent transparent}
.lc-root *::-webkit-scrollbar{width:8px;height:8px}
.lc-root *::-webkit-scrollbar-track{background:transparent}
.lc-root *::-webkit-scrollbar-thumb{background:transparent;border:2px solid transparent;background-clip:content-box;border-radius:999px}
.lc-root *::-webkit-scrollbar-corner{background:transparent}
.lc-root .lc-scrolling{scrollbar-color:rgba(0,0,0,.3) transparent}
.lc-root .lc-scrolling::-webkit-scrollbar-thumb{background:rgba(0,0,0,.3);background-clip:content-box}
.lc-root .lc-scrolling::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.45);background-clip:content-box}
body[data-ds-dark-theme] .lc-root .lc-scrolling{scrollbar-color:rgba(255,255,255,.3) transparent}
body[data-ds-dark-theme] .lc-root .lc-scrolling::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);background-clip:content-box}
body[data-ds-dark-theme] .lc-root .lc-scrolling::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.45);background-clip:content-box}

/* 设置页：左侧分区导航，右侧详细设置 */
.lc-settings-body{padding:18px 22px 0;display:flex;flex-direction:row;gap:16px;overflow:hidden;align-items:stretch}
.lc-settings-nav{flex:0 0 200px;width:200px;align-self:flex-start;max-height:100%;overflow:auto;background:var(--td-bg-color-container);border:1px solid var(--td-component-stroke);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.lc-settings-nav-btn{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:var(--td-text-color-secondary);font:400 12.5px/18px var(--td-font-family);text-align:left;cursor:pointer;transition:background-color .15s,color .15s}
.lc-settings-nav-btn:hover{background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-primary)}
.lc-settings-nav-btn.is-active{background:var(--td-brand-color-light);color:var(--td-brand-color);font-weight:600}
.lc-settings-nav-btn svg{flex:0 0 auto}
.lc-settings-detail{flex:1 1 auto;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:14px;padding-bottom:30px;box-sizing:border-box}
.lc-settings-detail > .lc-settings-card{display:none}
.lc-settings-detail[data-active-settings="categories"] > .lc-settings-card:nth-child(1),
.lc-settings-detail[data-active-settings="day-range"] > .lc-settings-card:nth-child(2),
.lc-settings-detail[data-active-settings="local-calendar"] > .lc-settings-card:nth-child(3),
.lc-settings-detail[data-active-settings="data"] > .lc-settings-card:nth-child(4),
.lc-settings-detail[data-active-settings="obsidian"] > .lc-settings-card:nth-child(5){display:block}
.lc-settings-badge{flex:0 0 auto;padding:2px 7px;border-radius:5px;background:var(--td-brand-color-light);color:var(--td-brand-color);font:500 10px/16px var(--td-font-family)}
.lc-obsidian-enable{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;padding:10px 12px;border:1px solid var(--td-component-stroke);border-radius:8px;background:var(--td-bg-color-page)}
.lc-obsidian-enable > div{display:flex;flex-direction:column;gap:2px;min-width:0}
.lc-obsidian-enable strong{font:600 12.5px/18px var(--td-font-family);color:var(--td-text-color-primary)}
.lc-obsidian-enable span{font:400 11.5px/17px var(--td-font-family);color:var(--td-text-color-placeholder)}
.lc-obsidian-form{display:flex;flex-direction:column;gap:13px;margin-top:14px}
.lc-obsidian-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.lc-obsidian-label{font:500 12px/18px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-obsidian-input{width:100%;height:34px;padding:0 10px;border:1px solid var(--td-component-stroke);border-radius:7px;background:var(--td-bg-color-container);color:var(--td-text-color-primary);font:400 13px/20px var(--td-font-family);outline:none;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}
.lc-obsidian-input:focus{border-color:var(--td-brand-color);box-shadow:0 0 0 2px var(--td-brand-color-light)}
.lc-obsidian-input::placeholder{color:var(--td-text-color-placeholder)}
.lc-obsidian-path{font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--td-text-color-placeholder);word-break:break-all}
.lc-obsidian-grid{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:12px}
.lc-obsidian-interval-wrap{display:flex;align-items:center;gap:6px}
.lc-obsidian-interval-wrap .lc-obsidian-input{width:100px;flex:0 0 auto}
.lc-obsidian-interval-wrap span{font:400 12px/18px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-obsidian-actions{display:flex;gap:8px;flex-wrap:wrap}
.lc-obsidian-status{display:flex;flex-direction:column;gap:3px;padding:9px 11px;border:1px solid var(--td-component-stroke);border-radius:8px;background:var(--td-bg-color-page);font:400 11.5px/18px var(--td-font-family)}
.lc-obsidian-status strong{font-weight:600;color:var(--td-text-color-secondary)}
.lc-obsidian-status span{color:var(--td-text-color-placeholder);word-break:break-word}
.lc-obsidian-status.is-error{border-color:rgba(213,73,65,.35);background:rgba(213,73,65,.06)}
.lc-obsidian-status.is-error strong{color:var(--td-error-color)}
.lc-obsidian-status.is-ok strong{color:var(--td-success-color)}
.lc-obsidian-rules{margin-top:13px;padding-top:12px;border-top:1px solid var(--td-component-stroke)}
.lc-obsidian-rules h3{margin:0 0 4px;font:600 12px/18px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-obsidian-rules ul{margin:0;padding-left:18px;color:var(--td-text-color-placeholder);font:400 12px/20px var(--td-font-family)}
.lc-obsidian-rules li{margin:2px 0}
.lc-obsidian-rules code{padding:1px 4px;border-radius:4px;background:var(--td-bg-color-container);color:var(--td-text-color-secondary);font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace}
@media (max-width: 720px){
  .lc-settings-body{padding:14px 12px 0;gap:10px}
  .lc-settings-nav{flex-basis:150px;width:150px;padding:6px}
  .lc-settings-nav-btn{padding:8px;font-size:12px;gap:7px}
  .lc-settings-detail{padding-bottom:24px}
  .lc-obsidian-grid{grid-template-columns:1fr}
  .lc-obsidian-interval-wrap .lc-obsidian-input{width:90px}
}


/* ── 看板 ───────────────────────────────────────────────────────────── */
.lc-board{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;color:var(--td-text-color-primary)}
.lc-board-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--lc-brand);color:#fff;-webkit-app-region:drag;app-region:drag;user-select:none;-webkit-user-select:none}
.lc-board-head-main{min-width:0}
.lc-board-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-left:auto;flex-wrap:wrap;-webkit-app-region:no-drag;app-region:no-drag}
.lc-board-stat{font:400 12px/18px var(--td-font-family);color:rgba(255,255,255,.82);white-space:nowrap}
.lc-board-stat b{font-weight:600;color:#fff;margin-right:2px}
.lc-board-head .lc-icon-btn{color:rgba(255,255,255,.9)}
.lc-board-head .lc-icon-btn:hover{background:rgba(255,255,255,.16);color:#fff}
.lc-board-new{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border:1px solid rgba(255,255,255,.45);border-radius:8px;background:rgba(255,255,255,.14);color:#fff;font:500 12px/1 var(--td-font-family);cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}
.lc-board-new:hover{background:rgba(255,255,255,.24);border-color:rgba(255,255,255,.7)}
.lc-board-new:focus-visible{outline:2px solid #fff;outline-offset:2px}
.lc-board-body{flex:1 1 auto;min-height:0;overflow:auto;box-sizing:border-box;padding:16px 20px 24px}
.lc-board-cols{display:grid;grid-template-columns:repeat(3,minmax(260px,1fr));gap:14px;align-items:stretch;min-height:100%}
.lc-board-col{--lc-board-accent:#8f9aa8;display:flex;flex-direction:column;gap:10px;min-height:190px;padding:10px;border:1px solid var(--td-component-stroke);border-top:3px solid var(--lc-board-accent);border-radius:12px;background:var(--td-bg-color-secondarycontainer);transition:background .15s,border-color .15s,box-shadow .15s}
.lc-board-col.is-over{background:var(--lc-brand-soft);border-color:var(--lc-brand);box-shadow:inset 0 0 0 1px var(--lc-brand)}
.lc-board-col-head{display:flex;align-items:center;gap:7px;padding:2px 4px 7px;border-bottom:1px solid var(--td-component-stroke)}
.lc-board-col-dot{width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:var(--lc-board-accent)}
.lc-board-col-name{font:600 13px/18px var(--td-font-family);color:var(--td-text-color-primary);white-space:nowrap}
.lc-board-col-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;margin-left:auto;padding:0 6px;border-radius:10px;background:var(--td-bg-color-container);color:var(--td-text-color-secondary);font:500 11px/20px var(--td-font-family)}
.lc-board-list{display:flex;flex-direction:column;gap:8px;min-height:64px;flex:1 1 auto}
.lc-board-card{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--td-component-stroke);border-radius:10px;background:var(--td-bg-color-container);box-shadow:0 1px 2px rgba(15,23,42,.04);cursor:grab;transition:box-shadow .15s,border-color .15s,opacity .15s}
.lc-board-card:hover{border-color:var(--td-brand-color-focus);box-shadow:0 3px 10px rgba(15,23,42,.08)}
.lc-board-card:focus-visible{outline:2px solid var(--lc-brand);outline-offset:2px}
.lc-board-card.is-dragging{opacity:.42;cursor:grabbing}
.lc-board-card.is-busy{opacity:.62;pointer-events:none}
.lc-board-card-top{display:flex;align-items:flex-start;gap:8px}
.lc-board-check{margin-top:2px}
.lc-board-card-title{flex:1 1 auto;min-width:0;font:500 13px/19px var(--td-font-family);color:var(--td-text-color-primary);word-break:break-word}
.lc-board-card-title.is-done{text-decoration:line-through;color:var(--td-text-color-placeholder)}
.lc-board-card-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font:400 11px/16px var(--td-font-family);color:var(--td-text-color-secondary)}
.lc-board-cat{display:inline-flex;align-items:center;gap:4px;max-width:132px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.lc-board-cat-dot{width:7px;height:7px;flex:0 0 auto;border-radius:50%}
.lc-board-date{white-space:nowrap}
.lc-board-date.is-overdue{color:var(--td-error-color);font-weight:500}
.lc-board-tomatoes{font-size:11px}
.lc-board-empty{display:flex;align-items:center;justify-content:center;min-height:64px;padding:10px;border:1px dashed var(--td-component-border);border-radius:8px;color:var(--td-text-color-placeholder);font:400 12px/18px var(--td-font-family);text-align:center}
.lc-board-error{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;padding:8px 12px;border-radius:8px;background:var(--td-error-color-light);color:var(--td-error-color);font:400 12px/18px var(--td-font-family)}
.lc-board-error .lc-btn{flex:0 0 auto;height:26px;padding:0 10px;font-size:12px}
body[data-ds-dark-theme] .lc-board-body{background:#242424}
body[data-ds-dark-theme] .lc-board-col{background:#2b2b2b;border-color:#393939}
body[data-ds-dark-theme] .lc-board-col-count{background:#242424}
body[data-ds-dark-theme] .lc-board-card{background:#242424;border-color:#3a3a3a;box-shadow:0 1px 2px rgba(0,0,0,.32)}
body[data-ds-dark-theme] .lc-board-card:hover{border-color:#4b5f86;box-shadow:0 3px 12px rgba(0,0,0,.3)}
body[data-ds-dark-theme] .lc-board-col.is-over{background:rgba(47,124,246,.16);border-color:var(--lc-brand)}
@media (max-width:720px){
  .lc-board-head{padding:12px 14px}
  .lc-board-actions{gap:6px}
  .lc-board-stat{font-size:11px}
  .lc-board-new{height:28px;padding:0 10px}
  .lc-board-body{padding:12px 12px 18px}
  .lc-board-cols{grid-template-columns:repeat(3,minmax(240px,1fr));gap:10px}
  .lc-board-col{padding:8px;border-radius:10px}
}

`;

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register({ name: 'sidebar.panellist', id: 'calendar', order: 5, label: '任务日历' }, (props) =>
              h(PanelButton, props),
            ),
          ),
        );
        ctx.effect(() =>
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: 'calendar' }, () => h(CalendarApp)),
          ),
        );
      },
    };
  },
});
