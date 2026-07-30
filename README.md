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

## 登录方式（推荐 Cloudflare Access）

默认是单个 Access Token（服务端只存 SHA-256，明文只在初始化/轮换时显示一次）。
更好的做法是把登录交给 Cloudflare Zero Trust —— 邮箱 OTP / Google / GitHub 登录，
会话自动过期、有审计日志，本地不再保管任何长期凭证。免费层 50 seats。

配置顺序（**先配 Access，确认生效后再关 token 兜底**，否则配错就把自己锁在门外）：

1. Zero Trust → Access → Applications → **Add a self-hosted application**
   - Application domain：`asc.你的域名`（留空 path = 保护整站）
   - Policy：Allow，条件用 Emails = 你的邮箱
   - 建完在应用概览复制 **Application Audience (AUD) tag**（64 位十六进制）
2. **再建第二个应用给 webhook 放行**：domain 同上、path 填 `webhook`，
   Policy 选 **Bypass / Everyone**。Apple 与 ASC 的服务器没法登录，不放行会直接断流。
   （若 ASSN URL 仍指向 `*.workers.dev`，那条不经 Cloudflare 代理，本步可跳过）
3. 本站「设置 → 登录与安全」填团队域名（`xxx.cloudflareaccess.com`）与 AUD → 保存
4. 刷新页面，走一次 Cloudflare 登录。该页首行显示 **Cloudflare Access + 你的邮箱** 即已生效
5. 点「关闭 Token 兜底」—— 此后只认 Access。这一步会校验「当次请求确实是 Access 认证的」，
   没生效时点不动，防的就是把自己关在外面

Worker 侧只做验签：JWKS 公钥（缓存 1 小时）+ `aud` 命中本应用 + `iss` 是本团队 + 时间窗。
`workers.dev` 域名不经 Cloudflare 代理、Access 管不到它 —— 关闭 token 兜底后那条路径上的
`/api`、`/push` 会一律拒绝（`/webhook` 不受影响，它靠 Apple 签名而非登录态）。

Access 出问题要恢复兜底：

```
npx wrangler d1 execute ascmonitor --remote --command \
  "UPDATE config SET value='on' WHERE key='auth_token_fallback'"
```

## 安全说明

- ASSN V2 验签：JWS x5c 证书链逐级验证 + Apple Root CA - G3 指纹固定 + 叶证书有效期检查
- ASC Webhook 验签：HMAC-SHA256 常数时间校验（`subtle.verify`，不做字符串比较）
- 幂等：`notificationUUID` 主键去重，Apple 重试不会重复入库
- 认证：Cloudflare Access（JWT 验签）优先，Access Token 兜底；token 服务端只存 SHA-256、
  常数时间比较、连续 8 次失败锁 15 分钟、可随时轮换
- 鉴权相关的 config 键不走通用 `/api/config` 路径：读会泄露凭证，写能绕过 `/auth/*` 的检查
- 敏感配置（.p8 私钥等）只写不读回
