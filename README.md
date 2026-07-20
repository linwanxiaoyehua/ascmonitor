# ASCMonitor

部署在 Cloudflare 免费层的 App Store 监控平台（PWA）：实时订阅/购买事件、收入指标、评论评分监控、差评告警。

- **Worker**（Hono + D1）：ASSN V2 Webhook 接收验签、Dashboard API、Web Push、cron 抓取
- **Web**（React + Vite PWA）：移动端优先 Dashboard，可安装到主屏、支持推送

需求文档见 [`ASO监控分析平台需求文档.md`](./ASO监控分析平台需求文档.md)。

## 本地开发

```bash
npm install
npm run db:migrate:local        # 初始化本地 D1
npm run build                   # 构建前端（Worker 托管 web/dist）
npm run dev                     # wrangler dev → http://localhost:8787
# 前端热更新开发另开：npm run dev:web（proxy 到 8787）
npm test                        # worker 单元测试（JWS 验签等）
```

## 部署（Cloudflare 免费层）

```bash
cp wrangler.example.jsonc wrangler.jsonc   # 部署配置（已 gitignore，含私有信息）
npx wrangler d1 create ascmonitor          # 把返回的 database_id 填入 wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

`wrangler.jsonc` 不入库：它承载 D1 `database_id`、自定义域名等部署方私有信息。
以 `wrangler.example.jsonc` 为模板复制一份，填上自己的值即可。

可选配置（写入 D1 的 `config` 表）：

| key | 用途 |
|-----|------|
| `vapid_subject` | Web Push 的 VAPID subject（`https://` 或 `mailto:` URL），缺省 `https://example.com` |
| `telegram` | Telegram 告警渠道 `{"botToken":"…","chatId":"…"}`（也可在设置页填） |

## 初始化流程

1. 打开部署后的 URL → 点「首次初始化」，**保存生成的 Access Token**（只显示一次）
2. App Store Connect → App → App 信息 → App Store 服务器通知 → **V2**，Production URL 填 `https://<你的域名>/webhook/assn`
3. 设置页：
   - 「开启推送」（iOS 需 16.4+ 且先安装到主屏幕）
   - App 收到第一条通知后自动出现在列表，填入 **App Apple ID** 开始抓取评论评分
   - （可选）填 ASC API 凭证（Key ID / Issuer ID / .p8），启用可回复评论拉取
   - （可选）`PUT /api/config/telegram`：`{"botToken":"...","chatId":"..."}` 启用 Telegram 告警

## Cron 作业（免费层 5 个上限内用 3 个）

| 触发器 | 作业 |
|--------|------|
| `*/15 * * * *` | 评论抓取（游标分片 ≤40 请求/次）+ 告警评估 |
| `0 * * * *` | 预留（Phase 3 榜单/关键词） |
| `0 1 * * *` | 评分快照 + 指标日汇总 + 收入下降告警 |

## 默认告警规则

新差评（≤2 星）即时推送 · 24h 差评率 ≥30% · 日收入较 7 日均值降 ≥30% · Webhook 静默 24h 自检。可在「设置 → 通知与告警」开关与调参；告警历史在「动态」页筛选查看。

## 安全说明

- ASSN V2 验签：JWS x5c 证书链逐级验证 + Apple Root CA - G3 指纹固定 + 叶证书有效期检查
- 幂等：`notificationUUID` 主键去重，Apple 重试不会重复入库
- 所有 API 走 Bearer Token；敏感配置（.p8 私钥等）只写不读回
