# Box Radio 设计文档

状态：已对齐（grill-me 收口后落地）  
仓库目录：`D:\code\box-radio`  
插件 id：`box.radio`  
版本目标：`0.1.0`

本文是实现契约，不是意向清单。实现不得静默扩大范围。

---

## 1. 背景与目标

EnsoCode 插件市场已有「红果短剧」「番茄小说」：侧栏浏览 + 后台拉流 + 沙箱页播放。Box Radio 用同一挂点做**电台直播**。

v1 要让用户在会话侧栏里：

1. 打开即看到中国热门可播电台
2. 按名称搜索（可出全球结果）
3. 收藏 / 取消收藏
4. 点一台开始听，可暂停、调音量、停播
5. 关掉插件页再打开：收藏、音量、上次电台还在；**不自动播放**

不把本插件做成蜻蜓/喜马拉雅客户端，也不做 Agent 点播。

---

## 2. 已定决策

| 项 | 决定 |
| --- | --- |
| 目录名 | `box-radio` |
| 插件 id | `box.radio`（清单不允许 `box-radio`：必须带点、不能有连字符） |
| 展示名 | Box Radio |
| 界面文案 | 中文；显示名英文 |
| 设计文档 | 本文件，中文 |
| 许可证 | MIT |
| 数据源 | 只接 [Radio Browser](https://api.radio-browser.info/) |
| 默认列表 | `countrycode=CN`，`lastcheckok=1`，按 `votes` 降序 |
| 搜索 | 不限国家 |
| 流格式 | 只播 `hls=0` 的 MP3 / AAC HTTP 流；HLS 不点播 |
| 交互面 | 仅侧栏 `ui.view` |
| Agent 工具 | 不做 |
| 常驻 / 定时 | 不做；听的时候侧栏页保持打开 |
| 打开自动播 | 不做 |
| 台标 | `main` 拉取 favicon → data URL；失败用站名首字 |
| ICY 曲名 | 不做 |
| API 节点 | DNS 发现 `all.api.radio-browser.info`，随机选用，失败切换 |
| User-Agent | `BoxRadio/<version>` |
| 分发 | v1 只从本地文件夹安装，不提市场 PR |
| Git | 先本地仓库，能听后再考虑远程 |

---

## 3. 非目标（v1 明确不做）

- 蜻蜓 FM、喜马拉雅、云听、radio.cn 私有接口
- HLS（`.m3u8`）、DASH、RTMP、RTSP
- DRM / CENC 解密（红果短剧那条路径）
- ICY `StreamTitle` 解析与「正在播放」歌名
- 节目表、回听、点播专辑
- 后台挂机（侧栏关掉后继续播）
- Agent 工具、命令、MCP、预设
- 账号登录
- 录音、下载、转码落盘
- 市场签名发布

HLS 台可以出现在搜索结果里，但标记「暂不支持」且播放按钮不可用，避免用户点了黑屏。

---

## 4. 对照红果短剧

红果（`enso.hongguo` / 仓库 `enso-hongguo`）证明了这条链路在 Enso 里能工作：

- 权限只有 `ui.view`
- 侧栏 HTML 跑在 `sandbox="allow-scripts"` 的 iframe：**不能联网、不能 `<audio src="https://...">`**
- `main.mjs` 是完整 Node 进程，自己 `fetch`
- 页面用 `enso.call(method, args)` 调 `renderer.handle`
- 媒体按块走 `open` / `chunk`（界面调用返回值 ≤ 64KB）

Box Radio 抄挂点，不抄播放器复杂度：

| | 红果短剧 | Box Radio |
| --- | --- | --- |
| 内容 | 点播剧集，有片长 | 直播，无终点 |
| 封装 | 加密 MP4 → 分段 fMP4 | 已是 MP3/AAC 帧 |
| 缓存 | 本地留最近 N 集 | 不落盘，内存环形缓冲即可 |
| 播放器 | 进度条、倍速、下一集、画中画 | 播放/暂停、音量、当前台名 |
| 列表 | 推荐/搜索/分集 | 热门/搜索/收藏 |

---

## 5. 宿主约束（实现必须遵守）

来源：EnsoCode `docs/plugins.md`。

| 约束 | 值 | 对本插件的影响 |
| --- | --- | --- |
| 侧栏 iframe | `sandbox="allow-scripts"`，不同源 | 所有网络与音频都经 `main` |
| 页面资源 | 相对路径在打开时内联；外链不加载 | 禁止页面里写外网 `<img>` / `<audio src>` |
| `enso.call` 参数/返回 | 各 64KB | `chunk` 音频必须分片；台标 data URL 过大则缩小或放弃 |
| 未声明方法超时 | 2 秒 | `discover` / `search` / `open` / `chunk` / `cover` 必须写进 `contributes.methods` |
| 声明方法超时 | 最长 120 秒 | `open` 建议 30s，`chunk` 15s，`cover` 20s |
| 界面调用频率 | 每插件每秒 10 次 | 直播 `chunk` 轮询要算好：64kbps ≈ 8KB/s，一次 48KB 片约 6 秒才需要下一片，远低于 10/s |
| 连续失败 | 5 次熔断 30 秒 | `chunk` 空闲（流暂停）应返回 `{ eof:false, empty:true }` 而不是抛错 |
| 非常驻空闲退出 | 5 分钟 | 正在收听时页面必须持续 `chunk`，否则进程被回收、流断 |
| `net.fetch` 权限 | 声明域名才走宿主 fetch | 本插件不申请；`main` 用 Node 内置 `fetch` / `https` |
| 安装 | 只复制目录，不跑 `npm install` | v1 零 npm 依赖，只用 Node 内置模块 |
| 插件包 | ≤ 5000 文件、200MB | 无压力 |

---

## 6. 架构

```
┌─────────────────────────────────────────────┐
│ Enso 侧栏 iframe（sandbox，无网）            │
│  index.html + 内联 CSS/JS                   │
│  列表 / 搜索 / 收藏 / 迷你播放器             │
│  MediaSource + HTMLAudioElement             │
│  enso.storage：favorites / volume / lastId  │
└──────────────┬──────────────────────────────┘
               │ enso.call(method, args)
               ▼
┌─────────────────────────────────────────────┐
│ main.mjs（插件 Node 进程）                   │
│  RadioBrowserClient  DNS 发现 + JSON API    │
│  StationFilter     去掉 lastcheckok=0、整理 │
│  CoverProxy        favicon → JPEG data URL  │
│  LivePump          HTTP 流 → 内存块队列     │
└──────────────┬──────────────────────────────┘
               │ HTTPS
               ▼
     Radio Browser 节点群          电台 Icecast/HTTP
     /json/stations/search         url_resolved
     /json/url/{uuid}
```

进程内只保持**一台**正在泵的流。`open` 另一台时先停旧泵。`stop` 或页面卸载时停泵。

---

## 7. 清单

`enso-plugin.json`：

```json
{
  "schemaVersion": 1,
  "id": "box.radio",
  "name": "Box Radio",
  "version": "0.1.0",
  "description": "在侧栏里浏览、搜索、收藏并收听互联网电台（Radio Browser，HTTP MP3/AAC）。",
  "main": "main.mjs",
  "permissions": ["ui.view"],
  "contributes": {
    "views": [{ "id": "radio", "title": "Box Radio", "entry": "index.html" }],
    "methods": [
      { "name": "discover", "timeoutMs": 30000 },
      { "name": "search", "timeoutMs": 30000 },
      { "name": "open", "timeoutMs": 30000 },
      { "name": "chunk", "timeoutMs": 15000 },
      { "name": "stop", "timeoutMs": 5000 },
      { "name": "cover", "timeoutMs": 20000 }
    ]
  }
}
```

不申请 `net.fetch`、`process.background`、`fs.*`。收藏只活在侧栏 `enso.storage`（每插件 1MB），卸载插件会清掉，可接受。

---

## 8. Radio Browser

### 8.1 发现节点

启动后第一次 API 调用前（或进程被回收后再次激活时）执行：

1. `dns.resolve4('all.api.radio-browser.info')` 得到 IP 列表（可再辅 `resolve6`）
2. 对每个 IP `dns.reverse`，得到主机名（如 `de1.api.radio-browser.info`）
3. 打乱数组，缓存到模块变量
4. 后续请求 `https://{host}/json/...`，带请求头：
   - `User-Agent: BoxRadio/0.1.0`
   - `Accept: application/json`（JSON 接口）
5. 单节点超时 8s；网络错误或 HTTP ≥ 500 换下一个；全部失败才把错误返回页面

反向解析失败的 IP 跳过。列表为空则回退尝试 `de1.api.radio-browser.info` **仅作为最后兜底**，并在插件日志里打一条警告。

### 8.2 接口

| 用途 | 方法 |
| --- | --- |
| 中国热门 | `GET /json/stations/search?countrycode=CN&hidebroken=true&order=votes&reverse=true&limit=50` |
| 搜索 | `GET /json/stations/search?name={q}&hidebroken=true&order=votes&reverse=true&limit=50` |
| 点台 | `GET /json/url/{stationuuid}` → 使用 `url_resolved` |

点台必须打 `/json/url/{uuid}`：既拿解析后的流地址，也给目录贡献点击（热门排序依赖它）。禁止为了「少一次请求」直接用列表里的 `url`。

### 8.3 台过滤与展示字段

从 JSON 收到后在 `main` 规范化，页面只消费精简结构：

```ts
type Station = {
  id: string;          // stationuuid
  name: string;
  country: string;     // countrycode，如 CN
  codec: 'MP3' | 'AAC' | 'OTHER';
  bitrate: number;     // kbps，未知为 0
  hls: boolean;
  playable: boolean;   // !hls && codec ∈ {MP3, AAC} && lastcheckok
  homepage?: string;
  hasFavicon: boolean;
  tags: string[];      // 最多 5 个，小写
};
```

规则：

- `lastcheckok !== 1`：丢弃，不进列表
- `name` 去空白后为空：丢弃
- `hls === 1` 或 codec 不是 MP3/AAC：保留条目但 `playable=false`
- codec 大小写不敏感，`AAC+` / `AAC+` 视作 AAC
- `limit` 服务端已限制；客户端不再二次分页（v1 一页 50 条）

### 8.4 错误映射

页面只展示中文短句，不把节点主机名甩出去。

| 情况 | 文案 |
| --- | --- |
| DNS / 全部节点失败 | 电台目录暂时连不上，请稍后重试 |
| 搜索无结果 | 没有找到电台 |
| 点了不可播（HLS） | 此台是 HLS，当前版本还不支持 |
| 流 HTTP 失败 / 非音频 | 无法播放此电台 |
| 播放中断 | 直播中断，点击重试 |

---

## 9. 直播泵与播放

### 9.1 打开

`open({ id })`：

1. 若已有泵，先 `destroy`
2. `GET /json/url/{id}`，取 `url_resolved`、`name`、`codec`
3. 若该台 `hls` 或 codec 不支持，返回 `{ ok:false, reason:'unsupported' }`
4. Node `fetch(url_resolved, { headers: { 'User-Agent': 'BoxRadio/0.1.0', 'Icy-MetaData': '0' }, redirect: 'follow' })`
   - 显式关闭 ICY，避免把元数据字节混进 MP3（v1 不做 ICY，必须关掉，否则 MSE 会解码失败）
5. 检查 `Content-Type` 含 `audio/mpeg` / `audio/mp3` / `audio/aac` / `audio/aacp` / `application/octet-stream` 之一；否则仍尝试，但日志警告
6. 启动后台 `ReadableStream` 读取，按约 48KB 切块（留出 JSON 包装余量，总返回 < 64KB）
7. 块进入内存队列，上限 32 块（约 1.5MB）。积压时丢最旧块（直播允许丢，避免暂停后暴音追赶）
8. 返回 `{ ok:true, id, name, mime }`  
   - MP3 → `mime: 'audio/mpeg'`  
   - AAC → `mime: 'audio/aac'`

### 9.2 取块

`chunk({ id })`：

- `id` 必须与当前泵一致，否则 `{ ok:false, reason:'stale' }`
- 队列有数据：弹出一块，返回 `{ ok:true, empty:false, eof:false, b64 }`（标准 base64）
- 队列空且流仍在：`{ ok:true, empty:true, eof:false }`（页面 200–400ms 后再要）
- 流结束或出错：`{ ok:true, empty:true, eof:true, error?: string }`

页面策略：

1. `open` 成功后 `new MediaSource`，`audio.src = URL.createObjectURL(ms)`
2. `sourceopen` 时 `addSourceBuffer(mime)`，`mode = 'sequence'`
3. 循环 `enso.call('chunk', { id })`：有 `b64` 则 `appendBuffer`；`empty` 则等待；`eof` 则 `endOfStream` 并提示中断
4. `SourceBuffer` 时长超过约 30s 时 `remove` 已播放部分，防止内存涨
5. 暂停：停 `chunk` 循环，**同时** `call('stop')`，避免 main 继续灌队列；恢复等于重新 `open`（直播不能从暂停点续，产品文案用「继续收听」实际是重连）

暂停即重连是有意简化：Icecast 没有暂停语义，队列一积压就会和直播时钟脱节。

### 9.3 停止

`stop({})` 销毁泵、取消 fetch、清空队列。页面切台、卸载、用户点停止时都要调。`deactivate()` 里同样停泵。

### 9.4 为何不用 Blob 渐进拼接

把整段直播拼成不断变大的 `Blob` 会内存泄漏。MediaSource + 定期 `remove` 才适合无限流。48KB × 10 次/秒理论上限远高于电台码率，实际轮询远低于限额。

---

## 10. 台标

`cover({ id, url })`：

- `url` 必须是 `https:` 或 `http:`；其它返回 `{ ok:false }`
- 超时 8s，最大下载 256KB，只接受 `image/jpeg|png|gif|webp|x-icon|vnd.microsoft.icon`
- 不在 `main` 里做复杂转码（无 ffmpeg 依赖）。超限或类型不对就失败
- 成功返回 `{ ok:true, dataUrl }`，页面塞进 `<img>`
- 页面按 `id` 记一次失败，同一会话不再请
- 失败：圆形底 + 站名第一个非空白字符

台标不进 `enso.storage`（1MB 预算要留给收藏 JSON）。

---

## 11. 页面与状态

### 11.1 信息架构

上到下：

1. 顶栏：标题「Box Radio」+ 搜索框
2. 分段：热门 | 收藏
3. 可滚动列表：台标、站名、国家码、码率、不可播标记
4. 底栏迷你播放器（始终占位）：台名、播放/暂停、音量、停止

空态：

- 热门加载中 / 失败可重试
- 收藏为空：「还没有收藏的电台」
- 搜索无结果：「没有找到电台」

### 11.2 视觉

- 跟随 `enso.theme` / `data-theme`（打开时快照，不跟随热切换——宿主限制）
- 用宿主 CSS 变量：`--border`、`--muted`、`--muted-foreground`、`--primary`、`--background`、`--foreground`
- zinc 中性、细边框、无花哨动效；尊重 `prefers-reduced-motion`
- 不引入 Tailwind 构建，不引用外网字体

### 11.3 `enso.storage` 键

| 键 | 值 |
| --- | --- |
| `favorites` | `string[]` stationuuid，最多 100，新的在前 |
| `volume` | `0–1` 数字，默认 `0.8` |
| `lastId` | 上次成功 `open` 的 uuid，仅用于列表高亮，不自动 `open` |

读写都在页面。`main` 不持久化业务状态（进程 5 分钟会退）。

### 11.4 交互

- 单击可播行：若不是当前台则 `open` 并播放；当前台则暂停/恢复（恢复=重连）
- 星标：只改 `favorites`，不打断播放
- 不可播行：点击提示「此台是 HLS，当前版本还不支持」
- 搜索：输入停止 300ms 后 `search`；清空回到热门
- 不使用 `alert` / `confirm`（iframe 无 `allow-modals`）

---

## 12. 方法契约

页面 `enso.call` ↔ `enso.renderer.handle`。

### `discover({})`

返回 `{ ok:true, stations: Station[] }` 或 `{ ok:false, error:string }`。

### `search({ q })`

`q` 去掉首尾空白，长度 1–80。空字符串当作 `discover`。返回同 `discover`。

### `open({ id })`

见 §9.1。

### `chunk({ id })`

见 §9.2。`b64` 与其它字段合计 JSON 序列化后必须 < 64KB。

### `stop({})`

返回 `{ ok:true }`。

### `cover({ id, url })`

见 §10。

所有 handler 不得把未捕获异常扔出进程；统一变成 `{ ok:false, error }`。

---

## 13. 目录结构（实现阶段）

```
box-radio/
  LICENSE
  README.md
  docs/design.md          ← 本文件
  enso-plugin.json
  main.mjs                激活、handler、DNS、泵
  radioBrowser.mjs        节点发现与 JSON 请求
  pump.mjs                直播分块队列
  cover.mjs               台标下载
  index.html              侧栏单页（CSS/JS 内联或相对路径，由宿主内联）
```

v1 不引入 `package.json` 依赖。ESM：`"type"` 不需要，文件用 `.mjs`。

---

## 14. 实现顺序

1. 清单 + 空侧栏页能在 Enso 里打开
2. `radioBrowser.mjs`：DNS 发现、discover/search、过滤；先用临时日志验证
3. 列表 UI：热门 / 搜索 / 不可播标记 / 收藏（storage）
4. `pump.mjs` + `open/chunk/stop` + MediaSource 播放 MP3
5. 音量、上次高亮、错误文案
6. `cover`
7. AAC 抽一两台实机确认 mime
8. 进程回收（停听 5 分钟再搜）和切台不停旧流的回归

每步都在本机 Enso「从文件夹安装」验证，不写自动化宿主测试（插件跑在 Enso 进程里，本仓库不嵌 Enso 源码）。

纯函数（过滤、分块切分、storage JSON 解析）若抽出，可用 Node 内置 `node:test` 测，不作为 v1 门槛。

---

## 15. 风险

| 风险 | 处理 |
| --- | --- |
| Radio Browser 节点在国内不稳定 | DNS 多节点切换；失败文案可重试 |
| 列表里大量假台 / 空名 / 失效流 | `hidebroken` + 本地 `playable`；播放失败提示换台 |
| Chromium MSE 对 `audio/mpeg` 行为差异 | 先 MP3；若 append 报错，记录 mime 并提示不支持，不在 v1 做 fMP4 remux |
| 部分流强制 ICY 且忽略 `Icy-MetaData: 0` | 检测 `icy-metaint` 响应头：若仍出现，在泵里按间隔剥掉元数据块（只剥，不解析标题） |
| `enso.call` 64KB / 10qps | 48KB 片 + 空队列慢轮询 |
| 侧栏关掉音频停 | 符合 v1 范围；文档与空态不承诺后台播放 |
| 版权 / 目录内容 | 本插件不镜像电台内容，只连接公开流；Radio Browser 为社区目录，对单台合法性不做保证 |

关于 ICY 剥除：这是播放正确性补丁，不是「做了 ICY 功能」。不把 `StreamTitle` 送到 UI。

---

## 16. 以后可能做、但现在不准做

未开新一轮决策前，代码里不要出现：

- HLS 转封装
- `process.background` 常驻收听
- Agent `play_station` 工具
- 市场 PR 所需的 `registry/meta`
- 第二数据源

需要时重新 grill，再改本文。