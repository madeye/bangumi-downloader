# Bangumi Torrent Finder

聚合 `bangumi.moe`、`acg.rip`、`動漫花園 (dmhy)`、`nyaa.si` 的番剧种子检索工具，自动去重、按番剧分组，支持批量复制磁力或打包下载 `.torrent` 文件。

基于 Next.js (App Router) + React + TypeScript，全部外部请求在服务端完成，provider token 不会暴露到前端。

## 功能

- 多源并行检索，一处搜索结果统一呈现
- 基于标题解析 + 可选 LLM 精炼的番剧分组（支持简繁日罗字幕组混排）
- 两段式响应：启发式结果先出，LLM 精炼后再在后台替换，不阻塞首屏
- 简繁偏好切换、字幕组/分辨率/集数元数据展示
- 批量操作：复制磁力、打开磁力、**打包下载所选种子为 zip**
- SQLite 搜索缓存（可配 TTL），相似查询直接命中缓存

## 本地启动

```bash
cp .env.example .env.local    # 按需调整
npm install
npm run dev                   # http://localhost:3000
```

其他脚本：

- `npm run build` / `npm start` — 生产构建与启动
- `npm run lint` — ESLint（flat config，沿用 `next/core-web-vitals` + `next/typescript`）
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest

## 环境变量

全部在服务端读取。provider 的 base URL / path 做成可配置，遇到上游路径变动或换镜像时只需改 env。

| 变量 | 作用 |
| --- | --- |
| `BANGUMI_MOE_API_BASE`, `BANGUMI_MOE_SEARCH_PATH` | bangumi.moe 搜索入口 |
| `ACG_RIP_API_BASE`, `ACG_RIP_SEARCH_PATH` | acg.rip RSS 入口 |
| `DMHY_API_BASE`, `DMHY_SEARCH_PATH` | 動漫花園 RSS 入口 |
| `NYAA_API_BASE`, `NYAA_SEARCH_PATH`, `NYAA_CATEGORY` | nyaa.si RSS 入口与分类 |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | 可选；配齐后启用 LLM 精炼分组。兼容任何 Anthropic 协议的端点（Kimi / MiniMax 等） |
| `CACHE_DB_PATH` | 搜索缓存 SQLite 路径，默认 `./.cache/search.sqlite` |
| `SEARCH_CACHE_TTL_SECONDS` | 缓存条目 TTL，默认 900s |

未配置 LLM 三件套时，分组降级为纯启发式，功能照常可用。

## 架构速览

```
app/page.tsx            —— 客户端搜索 UI
app/api/search          —— HTTP 适配：解析参数并委托 lib/search
app/api/download-zip    —— 代理拉取选中的 .torrent 并打包为 zip
lib/search.ts           —— 多 provider 并发聚合 + 去重 + 分组
lib/providers/*.ts      —— 每个上游一个文件，实现 SearchProvider
lib/types.ts            —— SearchSource 联合类型与统一 item 结构
lib/zip.ts              —— 依赖零的 STORE-only zip writer
```

不变量（改代码时请保持）：

- 所有上游 URL / token 只在服务端使用，不从客户端 import provider 模块
- provider 失败应通过 `warnings` 上报，不能把整个聚合响应抛挂
- provider 输出必须符合 `SearchResultItem` 的字段形状，UI 与排序都依赖它

## 新增 provider

1. 在 `lib/types.ts` 的 `SearchSource` 联合里加一个标识
2. 在 `lib/providers/` 新建一个实现 `SearchProvider { source, search(query) }` 的模块
3. 在 `lib/search.ts` 的 providers 数组中注册

## 测试

Vitest 覆盖分词/分组/去重/缓存/zip writer/`/api/download-zip` 路由等关键路径。新增功能请附上对应测试：

```bash
npm test
```
