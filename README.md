# 任务日历

一个运行在 DSH 里的本地优先任务日历插件。任务、分类、子任务、番茄记录、复盘和感想都保存在本机 SQLite，不依赖云端账号，也没有遥测。

## 功能

- **任务清单**：今天 / 明天 / 最近 7 天 / 收集箱 / 已完成筛选，日期分组可折叠，支持拖拽排序和标题里的自然语言日期。
- **日历**：日 / 周 / 月视图，农历、二十四节气、传统节日和 2025–2027 法定节假日；任务可拖拽改期、在日视图中拖动时间块和缩放时长。
- **看板**：未开始 / 进行中 / 已完成三列，拖动卡片改状态，卡片可直接完成，已放弃任务不显示。
- **四象限**：重要 × 紧急矩阵，可拖动任务单独调整象限，不影响优先级和截止日期。
- **总结**：日 / 周 / 月复盘，KISS 建议、内容归纳、每日 48 个半小时时间格、可手写感想。
- **番茄钟**：正计时 / 倒计时，完成后累计番茄和专注时长，按天统计。
- **分类与子任务**：自定义分类颜色，任务详情内最多 10 个子任务和完成进度。
- **本机日历**：只读读取 macOS「日历」中带具体时间的日程，和任务一起展示。
- **Obsidian**：把当天的未完成/已完成任务和「今日总结」写入本地 Obsidian 仓库的 `YYYY-MM-DD.md`，只更新指定标题段落，可设置自动写入间隔（DSH 运行时生效）。

## 安装

要求 Node.js 24+，DSH 已安装并运行。

1. 克隆仓库：

   ```bash
   git clone https://github.com/shuzitansuo/dsh-todolist-shuzitansuo.git
   ```

2. 打开 DSH profile 的 `package.json`（例如 `~/.dsh/profiles/default/package.json`），在 `dependencies` 中加入本地链接：

   ```json
   "@local/dsh-calendar": "link:/绝对路径/dsh-todolist-shuzitansuo"
   ```

   同时在 `dsh.profile.bundles` 中加入：

   ```json
   "@local/dsh-calendar"
   ```

3. 在 profile 目录安装依赖：

   ```bash
   pnpm install
   ```

4. 重启 DSH。侧栏会出现「任务」入口。

## 数据

所有业务数据都在：

```text
$DSH_HOME/calendar/db/calendar.sqlite
```

未设置 `DSH_HOME` 时默认为 `~/.dsh/calendar/db/calendar.sqlite`。数据库不在仓库里，首次启动会自动建表；升级或卸载插件不会删除数据。

## 隐私

- 不连接云端任务系统，不上传任务数据。
- 只有点击「检查更新」时会请求 GitHub Releases API；不发送本地数据。
- macOS 日历同步只读本机日历，写入插件自己的数据库。
- Obsidian 同步只读写填写的仓库目录下当天日志的指定段落，不联网、不读取其他笔记。

## 开发

```bash
node --check client.js
node --check index.js
for f in lib/*.js; do node --check "$f"; done
```

详细交互与数据表说明见 [docs/DETAIL.md](docs/DETAIL.md)，版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 目录

```text
client.js                 前端（React，通过 DSH ModuleLoader 加载）
index.js                  宿主端入口与路由注册
lib/store.js              SQLite schema、迁移与 CRUD
lib/api.js                /calendar/api 路由
lib/paths.js              数据目录解析
lib/update.js             GitHub 版本检查
lib/apple-calendar.js     macOS 日历读取
lib/CalendarSync.swift    macOS 日历辅助程序
cordis.patch.yml          DSH bundle 配置
locale/                   中英文描述
docs/DETAIL.md            完整功能说明
```
