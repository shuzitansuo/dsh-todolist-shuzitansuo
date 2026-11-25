/**
 * 检查 GitHub 上的新版本。
 *
 * 插件暂时没有内置仓库地址：优先读本地设置里保存的仓库，其次读
 * `DSH_CALENDAR_REPO`，最后读 package.json 的 repository。这样作者上传后
 * 只需要在“检查更新”弹窗里粘贴一次 `owner/repo`，所有用户也能用；
 * 如果希望安装即用，把 repository 写进 package.json 即可。
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT_MS = 12_000
const CACHE_TTL = 5 * 60 * 1000
const cache = new Map()

let packageCache = null

async function readPackage() {
  if (packageCache) return packageCache
  const raw = await readFile(join(ROOT, 'package.json'), 'utf8')
  packageCache = JSON.parse(raw)
  return packageCache
}

export async function pluginVersion() {
  const pkg = await readPackage()
  return String(pkg.version || '0.0.0')
}

/** 接受 owner/repo、GitHub URL、git+https URL，统一成 owner/repo。 */
export function normalizeRepo(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const text = raw.replace(/^git\+/i, '').replace(/\.git$/i, '')
  const matched = text.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i)
  if (matched) return matched[1] + '/' + matched[2]
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) return text
  return ''
}

async function packageRepo() {
  const pkg = await readPackage()
  const repository = pkg.repository
  const raw = typeof repository === 'string' ? repository : repository && repository.url
  return normalizeRepo(raw)
}

function compareVersions(a, b) {
  const parse = (value) =>
    String(value || '')
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

async function githubJson(path) {
  const response = await fetch('https://api.github.com' + path, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-calendar-update-check',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 404) return null
  if (!response.ok) {
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('GitHub API 请求次数已达上限，请稍后再试')
    }
    throw new Error('GitHub 返回 HTTP ' + response.status)
  }
  return response.json()
}

function friendlyError(error) {
  if (error && error.name === 'TimeoutError') return '连接 GitHub 超时，请检查网络后重试'
  const message = error instanceof Error ? error.message : String(error)
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return '连不上 GitHub，请检查网络或代理后重试'
  }
  return message
}

/**
 * @param {{ repo?: string, force?: boolean }} options
 */
export async function checkForUpdate(options = {}) {
  const current = await pluginVersion()
  const repo =
    normalizeRepo(options.repo) ||
    normalizeRepo(process.env.DSH_CALENDAR_REPO) ||
    (await packageRepo())

  if (!repo) {
    return { configured: false, current, repo: '' }
  }

  if (!options.force) {
    const hit = cache.get(repo)
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      return Object.assign({}, hit.value, { cached: true })
    }
  }

  let result
  try {
    const release = await githubJson('/repos/' + repo + '/releases/latest')
    if (release && release.tag_name) {
      const tag = String(release.tag_name)
      result = {
        configured: true,
        current,
        repo,
        tag,
        latest: tag.replace(/^v/i, ''),
        hasUpdate: compareVersions(tag, current) > 0,
        htmlUrl: String(release.html_url || 'https://github.com/' + repo + '/releases'),
        notes: String(release.body || '').slice(0, 8000),
        publishedAt: String(release.published_at || ''),
        source: 'release',
      }
    } else {
      const tags = await githubJson('/repos/' + repo + '/tags?per_page=1')
      if (!Array.isArray(tags) || !tags.length) {
        result = {
          configured: true,
          current,
          repo,
          error: '这个仓库还没有发布 Release 或 Tag',
        }
      } else {
        const tag = String(tags[0].name)
        const encoded = encodeURIComponent(tag)
        result = {
          configured: true,
          current,
          repo,
          tag,
          latest: tag.replace(/^v/i, ''),
          hasUpdate: compareVersions(tag, current) > 0,
          htmlUrl: 'https://github.com/' + repo + '/tree/' + encoded,
          downloadUrl: 'https://github.com/' + repo + '/archive/refs/tags/' + encoded + '.zip',
          notes: '',
          publishedAt: '',
          source: 'tag',
        }
      }
    }
  } catch (error) {
    result = { configured: true, current, repo, error: friendlyError(error) }
  }

  if (result.configured && !result.error) {
    cache.set(repo, { at: Date.now(), value: result })
  }
  return result
}
