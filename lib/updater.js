/**
 * 从 GitHub Tag 自动下载并应用插件更新。
 *
 * 只替换插件代码文件，保留 .git、node_modules、数据库和用户数据。更新前
 * 完整备份当前插件目录；复制失败会尝试回滚。安装完成后由 Host 请求
 * Electron 重启（开发模式或设置了 DSH_CALENDAR_NO_RESTART=1 时只提示）。
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { compareVersions, PLUGIN_ROOT } from './update.js'

const execFileAsync = promisify(execFile)
const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 120_000
const UNZIP_TIMEOUT_MS = 60_000
const REQUIRED_FILES = ['index.js', 'client.js', 'package.json']

function pluginHome() {
  const raw = String(process.env.DSH_HOME || '').trim()
  return raw || join(homedir(), '.dsh')
}

function skipEntry(name) {
  const base = basename(name)
  return base === '.git'
    || base === 'node_modules'
    || base === '.DS_Store'
    || base === 'updates'
    || /\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm))?$/i.test(base)
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function downloadWithCurl(url, destination) {
  await execFileAsync('curl', [
    '-fsSL',
    '--proto', '=https',
    '--max-time', '120',
    '--max-filesize', String(MAX_ARCHIVE_BYTES),
    '-o', destination,
    url,
  ], { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: 1024 * 1024 })
  const info = await stat(destination)
  if (info.size < 128) throw new Error('下载到的更新包为空')
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error('更新包超过 30MB，已拒绝')
  return info.size
}

async function downloadWithFetch(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'application/zip, application/octet-stream',
      'user-agent': 'dsh-calendar-auto-update',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('下载更新包失败：GitHub 返回 HTTP ' + response.status)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_ARCHIVE_BYTES) throw new Error('更新包超过 30MB，已拒绝')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('更新包超过 30MB，已拒绝')
  if (buffer.length < 128) throw new Error('下载到的更新包为空')
  await writeFile(destination, buffer)
  return buffer.length
}

async function downloadArchive(url, destination) {
  // 先走系统 curl：它会读取 macOS 的 HTTP(S)_PROXY，GitHub 的 codeload
  // 重定向在部分网络下用 Node fetch 会超时，curl 更可靠。
  try {
    return await downloadWithCurl(url, destination)
  } catch (curlError) {
    try {
      return await downloadWithFetch(url, destination)
    } catch (fetchError) {
      throw new Error('下载更新包失败：' + (fetchError.message || curlError.message))
    }
  }
}

async function extractArchive(archive, destination) {
  const listing = await execFileAsync('unzip', ['-Z1', archive], {
    timeout: UNZIP_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })
  const names = String(listing.stdout || '').split('\n').filter(Boolean)
  if (!names.length) throw new Error('更新包是空的')
  for (const name of names) {
    const normalized = name.replace(/\\/g, '/')
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error('更新包包含非法路径，已拒绝')
    }
  }
  await execFileAsync('unzip', ['-q', '-o', archive, '-d', destination], {
    timeout: UNZIP_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })
}

async function findArchiveRoot(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  if (dirs.length === 1) {
    const candidate = join(directory, dirs[0])
    try {
      await stat(join(candidate, 'package.json'))
      return candidate
    } catch {
      /* fall through */
    }
  }
  try {
    await stat(join(directory, 'package.json'))
    return directory
  } catch {
    throw new Error('更新包结构不正确：找不到 package.json')
  }
}

async function validateStage(stage, expectedVersion) {
  for (const file of REQUIRED_FILES) {
    try {
      await stat(join(stage, file))
    } catch {
      throw new Error('更新包缺少 ' + file)
    }
  }
  let pkg
  try {
    pkg = await readJson(join(stage, 'package.json'))
  } catch {
    throw new Error('更新包的 package.json 无法解析')
  }
  if (pkg.name !== '@local/dsh-calendar') {
    throw new Error('更新包不是 dsh-calendar 插件')
  }
  const version = String(pkg.version || '')
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('更新包版本号不合法')
  if (expectedVersion && compareVersions(version, expectedVersion) !== 0) {
    throw new Error('更新包版本与 Tag 不一致（包 ' + version + '，Tag ' + expectedVersion + '）')
  }
  return pkg
}

async function backupRoot(root, backupDir) {
  await mkdir(backupDir, { recursive: true })
  await cp(root, backupDir, {
    recursive: true,
    force: true,
    filter: (source) => !skipEntry(source),
  })
}

async function replaceRoot(stage, root) {
  const entries = await readdir(stage, { withFileTypes: true })
  for (const entry of entries) {
    if (skipEntry(entry.name)) continue
    const source = join(stage, entry.name)
    const target = join(root, entry.name)
    if (entry.isDirectory()) {
      await rm(target, { recursive: true, force: true })
      await cp(source, target, { recursive: true, force: true })
    } else {
      await cp(source, target, { force: true })
    }
  }
}

async function rollback(backupDir, root) {
  await cp(backupDir, root, {
    recursive: true,
    force: true,
    filter: (source) => !skipEntry(source),
  })
}

/**
 * 下载、校验并替换插件代码。root 仅用于测试覆盖。
 * @param {{ downloadUrl: string, expectedVersion?: string, root?: string, backupRoot?: string }} options
 */
export async function applyUpdate(options = {}) {
  const root = options.root || PLUGIN_ROOT
  const downloadUrl = String(options.downloadUrl || '')
  const allowed = /^https:\/\//i.test(downloadUrl)
    || (options.allowInsecure === true && /^http:\/\/127\.0\.0\.1(?::\d+)?\//i.test(downloadUrl))
  if (!allowed) throw new Error('更新地址不合法')

  const currentPkg = await readJson(join(root, 'package.json'))
  if (currentPkg.name !== '@local/dsh-calendar') throw new Error('当前插件目录不正确，已取消更新')

  const temp = await mkdtemp(join(tmpdir(), 'dsh-calendar-update-'))
  try {
    const archive = join(temp, 'update.zip')
    await downloadArchive(downloadUrl, archive)
    const extracted = join(temp, 'extract')
    await mkdir(extracted, { recursive: true })
    await extractArchive(archive, extracted)
    const stage = await findArchiveRoot(extracted)
    const nextPkg = await validateStage(stage, options.expectedVersion)
    if (compareVersions(nextPkg.version, currentPkg.version) <= 0) {
      throw new Error('更新包版本 ' + nextPkg.version + ' 不高于当前版本 ' + currentPkg.version)
    }

    const backupDir = join(
      options.backupRoot || join(pluginHome(), 'calendar', 'backups'),
      'plugin-' + String(currentPkg.version || '0') + '-' + stamp(),
    )
    await backupRoot(root, backupDir)

    try {
      await replaceRoot(stage, root)
    } catch (error) {
      try {
        await rollback(backupDir, root)
      } catch (rollbackError) {
        throw new Error('更新失败且回滚失败：' + error.message + '；备份在 ' + backupDir)
      }
      throw new Error('更新失败，已回滚：' + error.message)
    }

    return {
      from: String(currentPkg.version || ''),
      to: String(nextPkg.version || ''),
      backup: backupDir,
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 让 Electron 在响应返回后自动重启。开发模式、非 Electron 或显式关闭时不重启。
 */
export async function requestRestart(options = {}) {
  if (process.env.DSH_CALENDAR_NO_RESTART === '1') {
    return { started: false, reason: 'disabled' }
  }
  if (process.defaultApp) {
    return { started: false, reason: 'development' }
  }
  let app
  try {
    const electron = await import('electron')
    app = electron.app || (electron.default && electron.default.app)
  } catch {
    return { started: false, reason: 'not-electron' }
  }
  if (!app || typeof app.relaunch !== 'function') {
    return { started: false, reason: 'unsupported' }
  }
  setTimeout(() => {
    try {
      app.relaunch()
      app.exit(0)
    } catch {
      /* 重启失败时保留已更新的文件，下次手动重启生效 */
    }
  }, Math.max(500, Number(options.delayMs) || 1500))
  return { started: true }
}
