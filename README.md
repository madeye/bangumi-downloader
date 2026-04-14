# Bangumi Torrent Finder

一个使用 TypeScript 实现的 Web App，用于聚合 `bangumi.moe` 与 DHT 索引结果，提供基础的新番磁力链接和种子文件检索能力。

## 技术选型

- `Next.js + React + TypeScript`
- App Router 负责页面与 API 路由
- 服务端 provider 适配层负责拼接不同数据源

之所以选 Next.js，是因为这个项目同时需要：

- 一个响应式的搜索界面
- 一个服务端 API 层来代理外部源、隐藏 token，并统一输出数据格式
- 后续继续扩展抓取任务、入库、排行榜或订阅推送

## 已实现能力

- 首页搜索 UI
- `/api/search` 聚合搜索接口
- `bangumi.moe` provider
- DHT provider 接口约定，可连接你自己的索引服务
- 结果统一字段：标题、时间、大小、磁力、种子、标签、做种数

## 环境变量

复制 `.env.example` 为 `.env.local` 后按需调整：

```bash
BANGUMI_MOE_API_BASE=https://bangumi.moe
BANGUMI_MOE_SEARCH_PATH=/api/torrent/search
DHT_INDEXER_URL=http://localhost:8787/search
DHT_INDEXER_AUTH_TOKEN=
```

说明：

- `bangumi.moe` 的搜索路径做成了可配置，方便你按实际接口调整
- DHT 部分默认假设你有一个独立索引服务；前端 Web App 本身不直接参与 DHT crawling

## 本地启动

```bash
npm install
npm run dev
```

然后访问 <http://localhost:3000>。

## 后续建议

- 给 provider 增加更稳的字段映射与错误监控
- 接入 SQLite / PostgreSQL 做缓存和分页
- 为 DHT crawler 单独做 worker 服务，再由当前 API 聚合检索
- 增加番剧标签、字幕组、分辨率等高级筛选
