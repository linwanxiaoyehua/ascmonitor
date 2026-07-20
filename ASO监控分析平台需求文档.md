# ASO 监控分析平台（ASCMonitor）需求文档

> 版本：v0.3（2026-07-17）
> 前身：《StoreKit 2 监控平台（PWA）方案结论》

## 修订记录

| 版本 | 日期 | 主题 |
|------|------|------|
| v0.1 | — | StoreKit 2 订阅收入实时监控方案结论（PWA 选型、ASSN V2 接入） |
| v0.2 | 2026-07-16 | 定位升级为「一站式 App Store 运营监控与 ASO 分析平台」，新增口碑/ASO/竞品/告警模块与 Cloudflare 免费层部署方案 |
| v0.3 | 2026-07-17 | **现状对齐 + UI 重设计 + 免费层修正**：新增「现状诊断（as-built）」章；Dashboard 章整章重写（信息架构重组、技术选型 ADR、设计体系）；阶段规划改为 P1–P5 路线图（含验收标准）；修正免费层子请求预算模型（D1 查询计入 50 限制）；ASO 抓取规模修正 |

## v0.3 贯穿性修订原则

1. **口径可见**：任何出现数字的地方必须能回答「哪个来源、什么口径、多新鲜」——落地为 UI 口径徽标 + 本文档口径表双向对齐。
2. **免费层预算显性化**：每个 cron 任务在文档中带子请求（**含 D1 查询**）与 CPU 预算行，新功能设计先过预算表（见第九章）。
3. **as-built 优先**：文档描述与代码不一致时，以代码为准修文档，禁止「文档超前承诺」（教训：`jobs` 队列表只有 DDL 从未使用，见第三章）。

---

## 一、产品定位

打造一个围绕 App Store 生态的**实时监控 + ASO 分析平台**，覆盖开发者运营 App 的完整数据闭环：

| 层次 | 回答的问题 | 对应模块 |
|------|-----------|---------|
| 收入层 | 现在赚了多少钱？订阅健康吗？ | 收入与订阅监控 |
| 口碑层 | 用户怎么评价我？哪里在流失口碑？ | 评分与评论监控 |
| 增长层 | 用户从哪来？关键词/榜单表现如何？ | ASO 分析 |
| 竞争层 | 竞品在做什么？差距在哪？ | 竞品监控 |
| 响应层 | 出问题时我能第一时间知道吗？ | 告警与通知 |

**边界（明确不做）：**
- 不替代 StoreKit 2 的购买能力，不介入原生购买流程
- 不做归因平台（Adjust/AppsFlyer 的领域）
- 第一阶段不做 Google Play（架构上预留多商店抽象）

**设计原则（v0.3 新增）：**
- **能即时计算的指标不做物化快照**。快照/rollup 的失真面与物化面成正比（教训：`rollupDaily` 用当前时刻的 active_subs/mrr 覆写历史日期）。单用户数据量下 D1 免费读额度（500 万行/天）远超即时计算需要，只对确实昂贵的聚合（如 LTV cohort）做物化。

## 二、总体架构

```text
┌─────────────── 数据源 ───────────────┐
│ ① App Store Server Notifications V2  │ ← 实时订阅/购买事件（Webhook）
│ ② App Store Connect API              │ ← 销售报告 / 订阅报告 / 客户评论及回复
│ ③ iTunes 公开接口（RSS / Search /    │ ← 评分、榜单、搜索联想（定时抓取）
│    Lookup / Suggest）                │
└──────────────────┬───────────────────┘
                   │
        Ingestion 层（Webhook 接收 + 统一预算调度器分发 cron 作业）
                   │
              Worker（事件处理 / 聚合计算 / 告警引擎）
                   │
              D1（原始事件 + 物化状态 + 聚合快照 + 时序数据）
                   ├── Dashboard API（REST，Bearer Token）
                   └── 通知分发（Web Push / Telegram / 日报）
                          │
                    PWA（iPhone / Android / Desktop）
```

### 数据源与获取方式明细

| 数据 | 来源 | 方式 | 频率 | 稳定性 |
|------|------|------|------|--------|
| 订阅/一次性购买/退款事件 | ASSN V2 | Webhook 推送 | 实时（秒级） | 官方 |
| 销售与下载报告（含 proceeds） | ASC API `salesReports` | 定时拉取（gzip TSV） | 每日（T+1） | 官方 |
| 订阅状态快照（active/trial 存量） | ASC API 订阅报告 | 定时拉取 | 每日 | 官方 |
| 客户评论 + 开发者回复 | ASC API `customerReviews` | 定时拉取 | 每 15 分钟轮转 | 官方 |
| 各国评分/评论 | iTunes RSS `customerreviews` + Lookup | 定时抓取 | 每 15 分钟轮转 / 每日 | 半官方 |
| 榜单排名 | marketingtools RSS v2（总榜）；legacy RSS（分类榜，降级项） | 定时抓取 | 每 6 小时 | 半官方 / 易失效 |
| 关键词排名 | iTunes Search API（模拟搜索） | 定时抓取，游标分片 | 每日（词×国 ≤250） | 半官方 |
| 搜索联想词 | App Store Suggest 接口 | 定时抓取 | 每周 | 半官方 |
| 汇率 | open.er-api.com（fallback: jsDelivr currency-api） | 定时拉取 | 每日 | 第三方免费 |
| 页面浏览/转化率/来源 | ASC API `analyticsReports` | — | **Backlog**（多步异步报告流实现重、数据 T+2） | 官方 |

> **口径注（v0.3）**：评分分布（1–5 星占比）没有官方全量 API。iTunes Lookup 只给均分与总数；本平台的「评分分布」以**已抓取的文字评论星级**为样本近似，UI 必须标注该口径。不做 App Store 页面 HTML 抓取（脆弱且违反合规原则）。

---

## 三、现状诊断（as-built，2026-07-17）

> 本章是 v0.3 的基线：记录已实现范围、与 v0.2 承诺的差距、三类技术债。后续阶段规划（第七章）的每一项都源自本章。

### 3.1 已实现范围 vs v0.2 承诺（差距矩阵）

| v0.2 模块 | 已实现 | 未实现 / 偏差 |
|-----------|--------|--------------|
| A 收入与订阅 | ASSN V2 验签入库（JWS x5c 链 + Root CA 指纹固定）、幂等去重、订阅状态物化、今日收入/MRR/活跃/试用、事件流、ASC 销售+订阅报告拉取 | 指标表 8 项只落地 3 项：**Trial 转化率/续订率/退款率/Churn/LTV 全缺**；事件映射表只解读一半；收入仅 customer price 无 proceeds 切换；维度切分全缺 |
| B 口碑 | ASC + RSS 双源评论抓取（游标分片）、规则打标（6 条默认正则）、标签统计、评分快照（Lookup 均分）、差评告警 | **评论回复未接**（customerReviewResponses）；评分分布、版本前后对比未做；双源同评论重复入库未去重 |
| C ASO | 无 | **全缺**；hourly cron 空转预留 |
| D 告警 | 4 条默认规则（新差评/差评率/收入下降/webhook 静默）+ 静默期；Web Push（纯 WebCrypto VAPID + aes128gcm）；Telegram；日报 | 规则引擎不可配维度（webhook_silent 不分 App）；`channels_json` 里 `"push"` 不参与判断（无条件推）；Slack/飞书/邮件无 |
| E Dashboard | 5 tab PWA、深浅主题、骨架屏、空态 | 见 3.2 前端债清单 |
| 非功能 | 幂等、验签、敏感配置只写不读 | `jobs` 队列表（重试/死信）只有 DDL 零引用；.p8 明文存 config；测试仅覆盖 JWS 验签与打标 |

### 3.2 前端债（UI「混乱感」的根源）

结构性问题：
- **无路由**：`useState` 切页（`web/src/App.tsx:75`），刷新回总览、无 deep link、切 tab 卸载重挂全量重新请求。
- **无全局 App 切换器**：多 App 数据合并展示，无法按 App 查看——信息架构的结构性缺口。
- **口径混乱**：收入出现在 3 处；总览页并列「实时事件」与「销售报告」两套收入口径，仅靠 13px 灰字 section 标题区分；「活跃订阅」卡取 `Math.max(webhook 口径, ASC 快照)` 混合两口径（`Overview.tsx:129`）。
- **归属混乱**：「事件」流塞在收入 tab 内嵌 segment，却包含大量非收入事件（价格上调、沙盒通知），且残留独立页代码分支；告警规则在告警 tab 而送达渠道（推送开关）在设置；设置页 7 个 section 混装 onboarding / 日常运维 / 个人偏好三类事务。

组件与样式债：
- 13 个组件全为页面私有函数，`components/` 仅 Icon/AppIcon；5 套手写 Skeleton、3 处逐字重复的游标分页、5 处手写空态。
- 两套货币格式化并存：`usd()` 固定美元（api.ts）vs `money()` Intl 本地化（format.ts）。
- 两套手写 SVG 图表（柱状/折线）均无 tooltip、无触摸交互。
- `styles.css` 488 行：浅色 token 重复定义两遍（L33-54 与 L55-74 完全相同）；68 处 inline style；三套语义色命名并存（tone-* / pos-warn / pos-neg）；橙色 `.badge` 同时表示「已关续费/已退款/沙盒」三种语义；文案不一致（「已关续费/已关自动续费/关闭自动续费」）；原生 `alert()/prompt()` 突兀。

数据层：
- 监控产品却**无缓存、无自动刷新、无下拉刷新**。
- **12+ 处请求 catch 吞错**：接口失败时展示「暂无数据」空态，与真无数据不可区分（仅总览主请求有错误展示）。

### 3.3 后端债

- **指标失真**：`rollupDaily` 回填历史日期时 active_subs/mrr 取当前时刻值（`metrics.ts:150-160`）；`metrics_daily.trial_starts/trial_conversions` 列存在但从未写入。
- **收入漏计**：`REVENUE_EVENTS` 仅含 SUBSCRIBED/DID_RENEW/ONE_TIME_CHARGE（`metrics.ts:28`），`OFFER_REDEEMED` 与升级（UPGRADE 立即按比例扣款）的真实收入被漏计；汇率静态 14 币种，**未知币种系数 0 → 该笔收入直接蒸发**（`metrics.ts:15-18`）。
- **事件解读不全**：DID_CHANGE_RENEWAL_PREF（升降级）、PRICE_INCREASE、OFFER_REDEEMED、REFUND_DECLINED/REVERSED、GRACE_PERIOD_EXPIRED、RENEWAL_EXTENDED 仅存 raw，不改状态不推送。
- **告警缺陷**：`bad_review_rate` 按 `fetched_at` 统计 24h 窗口（`alerts.ts:75`）——新加 App 历史回填会把陈年差评灌进窗口造成误报，应改 `created_at`。
- **双源重复**：同一评论以 `asc:` 与 `rss:` 两个 id 双份入库，差评率与标签统计双重计数。

### 3.4 免费层预算债（v0.3 关键修正）

**D1 查询同样计入每次调用 50 子请求限制**（官方定义：subrequest 包括 Fetch API 及对 R2/KV/D1 等 Cloudflare 服务的请求；10ms CPU 限制同样适用于 Cron Trigger）。现有三个 cron 作业的「40 请求预算」只统计了外部 fetch：

- 评论抓取回填期每页 50 条 × 每条 3-4 次 D1 语句，早已越限，靠 try/catch 吞错 + 游标自愈苟活；
- daily cron 把 ratings（≤40 请求）+ sales（≤25）+ rollup + digest 串在**同一次调用**里（`index.ts:30-43`），冷启动回填期必然超限。

应对（P2 落地，详见 7.3）：统一预算调度器（fetch 与 D1 共享计数、超预算写游标断点续跑）+ 批量写全部走 `db.batch()`（一次 batch 计 1 个子请求）。

- 存储膨胀点：`notifications_raw.signed_payload`（含 x5c 证书链的 JWS）单条 5–15KB，是 D1 5GB 中唯一实质膨胀列 → 90 天后置空（保留解析后的结构化列）。

---

## 四、功能模块细化

### 模块 A：收入与订阅监控

**核心指标口径表（v0.3 重写；「展示位」对应模块 E 新 IA）：**

| 指标 | 定义口径 | 计算方式 | 展示位 | 落地期 |
|------|---------|---------|--------|--------|
| 今日收入 | 当日 SUBSCRIBED/DID_RENEW/ONE_TIME_CHARGE/OFFER_REDEEMED/UPGRADE 净额（扣退款），三口径可切 | 即时 SQL | 总览 KPI + 主图 | 已有（口径扩充 P2） |
| MRR / ARR | 非 trial 活跃订阅按月度化价格折算求和；ARR = MRR × 12 | 即时 SQL | 总览 KPI | 已有（ARR P1） |
| 活跃订阅数 | **单一数字**：ASC 快照日期 ≥ 昨日用快照（徽标「ASC·MM-DD」），否则 webhook 物化值（徽标「实时」）；废除 max() 混合 | 即时 | 总览 KPI | P1 |
| Trial 转化率 | 按**开始试用的周 cohort**：cohort 内 is_trial 订阅中出现首笔付费续期的比例 | 即时 SQL（transactions 自 join），`GET /api/metrics/trials?weeks=12` | 收入页漏斗 | P3 |
| 续订率 | 当期 DID_RENEW / (DID_RENEW + EXPIRED)，按首续/多续分层（交易序数） | 即时 SQL，`GET /api/metrics/sub-health?days=30` | 收入页 KPI | P3 |
| Churn | 月窗口 (expired + revoked) / 窗口起点活跃数；`expiration_intent` 区分主动（VOLUNTARY）与被动（BILLING_RETRY） | 同上 | 收入页 KPI（两列） | P3 |
| 退款率 | 30 天滚动 REFUND 笔数 / 成交笔数 | 同上 | 收入页 KPI | P3 |
| 维度切分 | 国家 / 产品两维，双口径 | `GET /api/metrics/breakdown?by=country\|product&caliber=events\|proceeds` | 收入页 | P3 |
| LTV（简版） | 月 cohort 累计收入 / 订阅者数 | `cohorts` 表 weekly 物化（唯一物化项） | 收入页底部 | P3 |

**收入三口径（全站统一定义）：**

| 口径 | 定义 | 来源 | 徽标 |
|------|------|------|------|
| 实时·客户价（默认） | 用户支付价（customer price），事件驱动 | transactions | 「实时」 |
| 实时·估算净得 | 客户价 × `config.proceeds_rate`（默认 0.85，小型企业计划账号级统一） | transactions | 「估算」 |
| 账单·实际净得 | Apple 结算 proceeds，T+1 | sales_daily | 「账单 · T+1」 |

proceeds 口径仅出现在：总览主图切换、收入页口径开关、对账模块三处。

**事件流映射（v0.3 补全，粗体为 P2 新增解读）：**

| ASSN V2 事件 | 平台行为 |
|--------------|---------|
| `SUBSCRIBED` + INITIAL_BUY / RESUBSCRIBE | 新订阅 / 重订，计收入，推送 |
| `DID_RENEW` | 续费计收入；offerType=1 且 price=0 判定 trial |
| `ONE_TIME_CHARGE` | 一次性购买计收入，推送 |
| **`OFFER_REDEEMED`** | **优惠兑换，计收入（含优惠类型入库）** |
| **`DID_CHANGE_RENEWAL_PREF` + UPGRADE** | **立即换产品并按比例计收入** |
| **`DID_CHANGE_RENEWAL_PREF` + DOWNGRADE** | **存 pending_product_id，下期生效** |
| `DID_CHANGE_RENEWAL_STATUS` + AUTO_RENEW_DISABLED | 标记关续费，推送 |
| `DID_FAIL_TO_RENEW`（± GRACE_PERIOD） | grace_period / billing_retry |
| **`GRACE_PERIOD_EXPIRED`** | **转 billing_retry** |
| `EXPIRED`（含 subtype） | 过期，**subtype 存 expiration_intent 供 Churn 主/被动拆分** |
| `REFUND` | 标记退款，推送 |
| **`REFUND_REVERSED`** | **撤销退款标记，复活订阅，恢复计收入** |
| **`REFUND_DECLINED`** | **仅事件流记录** |
| **`PRICE_INCREASE`（PENDING/ACCEPTED）** | **存 price_increase_status，事件流展示** |
| **`RENEWAL_EXTENDED`** | **顺延 expires_at** |
| `REVOKE` | 家庭共享撤销，置 revoked |

**用户生命周期视图：** Trial → Paid → Renew(×N) → (Grace → Retry) → Expired / Resubscribe。每个订阅可展开完整事件时间线（已有）。

### 模块 B：评分与评论监控

**B1 评分监控**
- 各国均分 + 评分数每日快照、趋势曲线（已有）
- **评分分布**（P4）：1–5 星占比直方图，**样本 = 已抓取的文字评论**（口径注见第二章），UI 标注样本口径
- **版本对比**（P4）：新表 `app_releases(app_id, version, released_at)`——daily cron 已在跑的 iTunes Lookup 顺带 diff `version` + `currentVersionReleaseDate` 写入（0 额外子请求）；输出新旧版本均分/差评率 + 发布前后 14 天对比卡

**B2 评论监控**
- 双源抓取（ASC 可回复源 + RSS 多国源）游标分片轮转（已有）；**P2 增加双源同评论关联去重**（按 app_id + reviewer + rating + title 标 canonical）
- 规则打标 + 标签统计（已有，6 条默认中英正则：崩溃/价格/功能请求/广告/登录/同步）
- **评论回复（P4）**：`reviews` 表加 `response_body / response_state / responded_at`；`POST /api/reviews/:id/reply` → ASC `POST /v1/customerReviewResponses`；仅 `asc:` 源可回复（UI 徽标「可回复」）；一评一回可覆盖；状态机 `PENDING_PUBLISH → PUBLISHED`（抓取时与评论同请求 `include=response` 同步状态，净增 0 子请求）；**前置检查凭证角色**——回复需 Admin / App Manager / Customer Support 角色的 API Key，仅财务权限的 key 会 403
- 新评论实时推送按星级过滤（已有：新差评即时推送）

**B3 竞品评论** → Backlog（见第七章）。

### 模块 C：ASO 分析（P5，可实施设计）

**C1 关键词追踪**
- 表：`keywords(id, app_id, keyword, countries_json, enabled)`、`keyword_rankings(keyword_id, country, date, rank NULL=未上榜, checked_at)` PK(keyword_id, country, date)——**日粒度**
- 抓取：iTunes Search API `limit=50`，在结果中定位目标 trackId 得排名
- **CPU 保护**（10ms 限制适用 cron）：不做全量 `JSON.parse`——`res.text()` 后文本定位 `"trackId":<id>` 出现位置、计数其前的 `"trackId":` 次数得 rank
- **规模上限（v0.3 修正）**：hourly 每次 12 个（词,国）单元 × 24 班 ≈ 280 检查/天 → 词×国组合 **≤250**（如 50 词 × 5 国）。v0.2 的「200 词 × 5 国 = 1000 次/日」在免费层不成立（子请求含 D1 的预算见第九章），超出需 Workers Paid
- 关键词覆盖分析、联想词推荐入库：`suggest_terms(seed, term, country, rank, fetched_at)`，weekly cron 采集（种子词 ≤30 请求）

**C2 榜单排名**
- 表：`chart_rankings(app_id, country, chart, date, hour, rank)`——小时粒度存 90 天，daily cron 降采样为日粒度后清理
- 来源：marketingtools RSS v2 `top-free / top-paid`（总榜，官方新接口）；分类榜走 legacy `itunes.apple.com/{cc}/rss` **标注降级项，失败静默**
- 节奏：hourly cron 中仅 `hour % 6 == 0` 班次执行（5 国 × 2 榜 = 10 请求）
- 告警：`keyword_rank_drop`（跌出 TopN）、`chart_rank_change`（±50 位）进 evaluateDaily

**hourly cron 单次预算（含 D1）：**

| 步骤 | 子请求 |
|------|--------|
| 读配置/游标（D1） | 2 |
| 关键词排名 12 单元（请求间 3s pacing，wall-clock 15min 内充裕） | 12 |
| 榜单快照（每 6 小时班次） | 0 或 10 |
| 落库 db.batch + 游标更新 | 2 |
| **合计** | **16–26（上限 40 留余量）** |

- 数据量核对：写入 ~330 行/天（限额 10 万的 0.3%）；存储 ~15MB/年，5GB 无压力
- API：`/api/keywords` CRUD、`/api/keywords/rankings?days=30`、`/api/charts?country&chart&days`

**C3 元数据与转化** → `analyticsReports`（页面浏览/转化/来源）与元数据历史存档**推迟 Backlog**：多步异步报告流（request → instance → segments）实现重、数据 T+2，性价比排在关键词/榜单之后。

**C4 竞品监控** → Backlog。

### 模块 D：告警与通知

**通知渠道：** Web Push + Telegram + 日报（已有）；Slack/飞书/邮件 → Backlog。

**v0.3 修正模型：**
- `channels_json` **真正生效**：`notify()` 接收 channels 参数，`"push"` 不在列表则跳过 Web Push（现状：无条件推送，配置值是摆设）
- `webhook_silent` **按 App 维度**：规则 `app_id` 生效，按 App 查 `MAX(received_at)`（现状：全局一条，多 App 时无法定位哪个 App 断流）
- `bad_review_rate` 窗口改按 `created_at`（评论创建时间）而非 `fetched_at`（抓取时间），消除历史回填误报
- 规则编辑 UI 化：阈值参数表单 + 渠道复选框（设置 → 通知与告警，Sheet 编辑）

**规则清单（现有 4 + P5 新增 2）：**

| 类别 | 规则 | 默认参数 |
|------|------|---------|
| 评论 | new_bad_review（新差评即时推送） | ≤2 星，静默 0 |
| 评论 | bad_review_rate（24h 差评率） | ≥30% 且 ≥5 条，静默 12h |
| 收入 | revenue_drop（昨日 vs 7 日均值） | 跌幅 ≥30%，每日评估 |
| 系统 | webhook_silent（管道自检，per-App） | 静默 ≥24h |
| ASO（P5） | keyword_rank_drop | 核心词跌出 Top10 |
| ASO（P5） | chart_rank_change | 榜单 ±50 位 |

**每日摘要**：昨日收入（vs 7 日均值）+ 新订/续费/退款 + 新评论数/均分（已有）；P5 后追加关键词红黑榜。

### 模块 E：Dashboard（PWA）——v0.3 整章重写

#### E1 信息架构

**核心原则：一个问题只在一个地方回答；数字必带口径徽标（来源 + 新鲜度）；实时流是这个产品的多巴胺，给它正式席位。**

**Tab 结构（两阶段演进）：**

| 阶段 | Tab 1 | Tab 2 | Tab 3 | Tab 4 | Tab 5 |
|------|-------|-------|-------|-------|-------|
| P1 UI 重构后 | 总览 | 收入 | 评论 | 动态 | 设置 |
| P5 ASO 上线后 | 总览 | 收入 | 评论 | **增长** | 设置 |

- **告警 tab 解散**：规则配置迁入「设置 → 通知与告警」；告警历史并入「动态」信息流（筛选 chip）。理由：单用户场景下几条规则的开关不值一个一级入口，而告警事件与交易事件本质同构，属于同一条时间流。
- **P5 时「动态」降级为路由页** `/activity`：总览顶部保留「今日动态」预览卡（最近 5 条）点击进全屏页，腾出 tab 给「增长」。
- **全局 App 切换器**：所有数据页顶部 slim header 左侧 App chip（点击弹 bottom sheet：全部 Apps / 各 App 带图标）；选择持久化 localStorage 并同步 URL query（`?app=`，刷新/分享保持）；header 右侧放**数据新鲜度指示点**（最近 webhook 事件时间）+ 手动刷新按钮。

**每页模块清单（从上到下）：**

*总览 `/`* — 回答「现在怎么样」
1. Header（App 切换器 + 新鲜度点 + 刷新）
2. KPI 2×2：今日收入（vs 昨日 delta）· MRR（ARR 副行）· 活跃订阅 · 试用中——每卡带口径徽标
3. 收入趋势主图：7/30/90 天切换，默认「实时·客户价」，chip 可切「账单·净得」（**替代现状两图并列**）
4. 今日动态预览（最近 5 条交易/告警/差评合流）→「查看全部」
5. 口碑一瞥：今日评论数/均分 + 最新差评摘要 → 进评论页
6. 下载量卡（30 天，唯一来源账单报告，标注「T+1」）
7. （P5）关键词红黑榜 Top3

*收入 `/revenue`* — 回答「订阅生意健康吗」
1. 口径开关（客户价 / 估算净得 / 账单实际）+ 时间范围
2. 订阅健康 KPI：续订率 · Trial 转化率 · 退款率 · Churn（主/被动分列）（P3；P1 先以 MRR/ARR/新订/退款 4 卡占位）
3. 收入趋势图（新订/续费/一次性堆叠柱）
4. Trial 周 cohort 漏斗（P3）
5. 维度切分：国家/产品横向条形 + 明细（P3）
6. 订阅健康与对账卡：webhook vs ASC 快照订阅数、事件收入 vs 账单 proceeds 30 天差值%（P2）
7. 订阅列表（状态分组 + 行内时间线，保留）⇄ 一次性购买流水（SegmentedControl 切换）

事件 segment 从收入页移除（`EventsPage embedded` 残留删除），归入动态页。

*评论 `/reviews`* — 回答「用户怎么说、我回了没」
1. Rating hero：加权均分 + 7 天 delta + 30 天 sparkline + 国家 chips
2. 评分分布条（P4，标注样本口径）
3. 版本对比卡（P4）
4. FilterBar：全部/差评/未回复 + 标签 chips + 国家 + 版本
5. 评论流（回复状态徽标：未回复/待发布/已发布；卡片操作「回复」弹 Sheet，P4）
6. 无限加载

*动态 `/activity`*
1. 筛选 chips：全部 / 收入 / 订阅变化 / 退款 / 告警 / 系统（含沙盒开关）
2. 按天分组的合流时间线（后端 `GET /api/activity`：notifications_raw ∪ alert_events 统一分页）
3. 无限加载

*设置 `/settings`* — 按「配置一次 / 偶尔运维 / 日常偏好」三层分组，二级页路由化：
- **接入与凭证**：Webhook URL 复制、ASC 凭证（含角色要求说明）、Vendor Number、Access Token 重置
- **App 管理**：App 列表（二级页：Apple ID、监控国家、竞品预留）、手动添加
- **通知与告警**：推送开启/测试、Telegram、**告警规则列表 + Sheet 编辑**、日报开关
- **数据运维**：手动抓取（评论/账单/排名）、**数据健康页**（webhook 最近事件、汇率更新时间、对账偏差、双源评论重复数、未折算币种桶）
- **偏好**：主题、默认口径、货币显示
- **关于**：版本、开源链接

#### E2 技术选型（ADR）

| 领域 | 决策 | 落选项 | 理由 | 退路 |
|------|------|--------|------|------|
| 路由 | **wouter**（~2KB gz，browser history） | react-router（~35KB，data API 用不上）；手写 hash | 6 路由 + 2 参数页规模 hooks API 足够；Worker 已配 SPA fallback | API 接近 react-router，迁移平滑 |
| 数据层 | **TanStack Query v5**（~12KB） | SWR（4KB 但 useSWRInfinite 处理 before 游标别扭、无 mutation 原语） | 刚需清单即 TQ 功能表：useInfiniteQuery（3 处游标分页）、refetchOnWindowFocus（PWA 后台唤醒刷新）、refetchInterval、QueryCache 全局 onError（根治 12 处吞错）、乐观更新（规则开关/回复提交） | — |
| 图表 | **Recharts**（tree-shake ~55KB，路由级懒加载） | uPlot（12KB 但 canvas + tooltip/触摸全 DIY）；visx（等于自建图表库）；继续手写 | 柱/线/面积 + 触摸 tooltip + ResponsiveContainer 开箱即得；数据点 ≤365 性能无虞 | `TrendChart` 包装层隔离依赖，bundle 成问题时降级 uPlot |
| 持久化 | `@tanstack/query-persist-client` + localStorage（+3KB，推荐） | — | PWA 冷启动直接渲染上次数据再后台刷新，「掏出手机看一眼」场景收益极高 | 可选项，随时可摘 |

**Bundle 预算**：react 45 + wouter 2 + TQ 12 + recharts 55 + 应用代码 ~25 ≈ **140KB gz 全量**；按路由 `React.lazy` 切块，首屏（登录 + 外壳 + 总览骨架）**<80KB gz**，图表 chunk 懒加载；SW precache 后二次打开 0 网络成本。

#### E3 设计体系

**视觉方向**：脱离 iOS 拟真，转向现代监控 dashboard 语言（参照 Linear / Vercel / Grafana 的暗色系）：
- 深色优先：背景深蓝灰（如 `#0B0E14`）而非纯黑，表面 `#141A23`，用 **1px 低透明度描边**（`--border-subtle`）替代纯填充分层
- 单一品牌 accent（靛/蓝紫系，与 App Store 蓝区分）；KPI 大数字 tabular-nums + 紧字距
- 图表色板独立于 UI 语义色（6 分类色 + 单色渐变序列）；正/负走势固定绿/红且与成功/危险语义色区分色阶
- 字体：系统栈保留（PingFang 中文渲染最佳）；字阶收敛 12/13/15/17/22/28 六档；页面标题 22px 加粗（取消 34px Large Title，密度优先）

**Token 三层重建**（`tokens.css`）：
1. 原语层：中性色阶 `--gray-0..900`、品牌阶、功能色阶（每色 3 档：默认/柔和底/强调文字）
2. 语义层：`--bg-app / --bg-surface / --bg-raised / --border-subtle / --text-1/2/3 / --accent / --success / --danger / --warning / --info` + 各自 `-soft`
3. 组件层：仅 `--radius-card:12px / --radius-control:8px / --radius-pill`、间距 4px 基数 `--s1..s8`

**深浅主题**：CSS `light-dark()` 函数（Safari 17.5+ / Chrome 123+，2026 年个人工具无兼容顾虑）——每 token 只声明一次 `--bg-app: light-dark(#f6f7f9, #0b0e14)`，配合 `:root { color-scheme: light dark }` 与手动覆盖 `:root[data-theme='light'] { color-scheme: light }`。**从机制上消灭浅色 token 重复定义**；`theme.ts` 仅保留切 color-scheme 与 meta 同步。

**语义收敛**：
- 删除 `--blue/--green/...` 直接引用，全部走语义名
- Badge 组件 5 tone：`neutral`（沙盒）/ `warning`（已关续费、宽限期）/ `danger`（已退款、扣款失败）/ `info`（升降级、优惠）/ `success` —— 退款不再与关续费同色
- 货币格式化归一 `lib/money.ts`：`fmtUsd(milli)`（聚合指标，恒 USD）与 `fmtMoney(milli, currency)`（单笔交易，原币种），注释写明分工，删除 api.ts 的 `usd()`
- 文案统一：订阅关闭续费固定为「已关续费」

#### E4 共享组件清单

AppShell（TopBar + TabBar + 路由出口）/ TopBar / AppSwitcher / PageHeader / **StatCard**（label, value, delta?, badge?, icon?, loading?, onPress?）/ Section（title, count?, action?）/ **ListRow**（leading?, title, titleBadges?, detail?, trailing: 'chevron'|node, amount?, time?, onPress?）/ **Skeleton**（variant: rows|cards|chart）/ EmptyState / **ErrorState**（现状缺失）/ LoadMore（直连 useInfiniteQuery）/ SegmentedControl / FilterChips / **Badge**（5 tone）/ **Sheet**（底部弹层，替代 alert/prompt；回复、规则编辑、App 切换共用）/ **Toast**（全局单例，接 QueryCache onError）/ **TrendChart**（Recharts 包装，注入 token 色板与统一 tooltip）/ DistributionBars（评分分布/维度切分共用）/ Sparkline（纯 SVG 保留）/ RelativeTime。

inline style 清理规则：布局类收进组件，仅保留真正动态值（目标全站 ≤10 处）。

#### E5 数据层规范（加载/空/错/刷新四态标准）

- QueryClient 默认：`staleTime: 60s`、`gcTime: 30min`、`refetchOnWindowFocus: true`、`retry: 1`
- Key 规范：`['overview', appId]`、`['metrics', appId, days, caliber]`、infinite `['events', appId, filter]` + `pageParam=before`
- 自动刷新：总览与动态页 `refetchInterval: 60s`（仅页面可见时）；其余靠 focus refetch
- 下拉刷新：自研轻量 PTR（iOS standalone 无原生下拉刷新，此组件是 PWA 体感关键件）→ `invalidateQueries({ active })`
- **错误全局化**：`QueryCache({ onError })` → Toast + 页面级 ErrorState（onRetry）；**空态只在真正 2xx 空数组时出现**；`ApiError(401)` 全局拦截清 token 回登录
- 乐观更新：告警规则开关、评论回复提交（卡片立即置「待发布」）

---

## 五、非功能性需求

| 项 | 要求 |
|----|------|
| 租户 | 单用户（自用）；多租户不做，.p8 加密存储列入 Backlog |
| 安全 | ASSN V2 签名（JWS x5c 链 + Root CA G3 指纹固定）验证；ASC Token 按需签发；API 全走 Bearer Token；敏感配置只写不读回 |
| 可靠性 | Webhook 幂等（notificationUUID 去重）；抓取游标分片 + 断点续跑（统一预算调度器，P2）；FX 源失败沿用上次快照 |
| 数据保留 | 结构化事件永久；`signed_payload` 90 天后置空；榜单小时级数据 90 天后降采样为日级 |
| 时区 | 统一 UTC 存储，展示层本地化 |
| 抓取合规 | 公开接口限速（请求间 3s pacing）、结果缓存、词×国规模上限 250 |

## 六、数据模型

**现有 16 表（as-built 基线）**：`apps` / `config`（单用户 KV）/ `notifications_raw` / `transactions` / `subscriptions` / `metrics_daily` / `reviews` / `review_tags` / `tag_rules` / `ratings_snapshots` / `alert_rules` / `alert_events` / `push_subscriptions` / `sales_daily` / `subs_snapshot_daily` / ~~`jobs`~~。

**决策：DROP `jobs` 表**（P2）。config 游标模式已实现同等分片语义并被 3 个作业验证；空表留着违反 as-built 原则。P5 若出现真实多队列需求再按需重建。

**迁移增量：**

| 迁移 | 变更 |
|------|------|
| 0002（P2） | `transactions` + `event_subtype, offer_type, offer_discount_type, is_trial`；`subscriptions` + `pending_product_id, price_increase_status, trial_started_at, converted_at, expiration_intent`；DROP `jobs`；config + `fx_rates_auto, fx_updated_at, proceeds_rate` |
| 0003（P3） | 新表 `cohorts(app_id, cohort_month, subs, revenue_milli_cum)`；`metrics_daily.trial_starts/trial_conversions` 开始由 rollup 真实写入（列已存在） |
| 0004（P4） | `reviews` + `response_body, response_state, responded_at, canonical_id`；新表 `app_releases(app_id, version, released_at)` |
| 0005（P5） | 新表 `keywords` / `keyword_rankings` / `chart_rankings` / `suggest_terms`（字段见模块 C） |

## 七、阶段规划（v0.3 路线图）

> 旧 Phase 1/2 已交付（部分），差距见第三章矩阵。以下为新分期。

**依赖图与顺序理由：**

```
P1 UI 平台重构（前端）──┐
                        ├──→ P3 收入深化 ──┐
P2 数据健壮性（后端）──┘        │           ├──→ P5 ASO 启动
                        └──→ P4 口碑闭环 ──┘
```

1. **P1 先行**：新 IA 决定后续每个功能的落点（漏斗、对账、回复、关键词都要有地方放），先做功能再重构等于每个功能搬两次家。
2. **P2 是 P3 硬依赖**：Trial/Churn/续订率全依赖 P2 落库的 subtype/offer_type/is_trial 字段与修正后的 rollup；P2 的统一预算调度器又是 P5 hourly 分片的地基。
3. **P1 ∥ P2 前后端分层**，单人可交错推进。
4. **P4 只依赖 P1 + ASC 凭证**，与 P3 解耦可换序（差评多先做 P4，收入疑惑多先做 P3）。
5. **P5 最后**：唯一依赖非官方接口的方向，风险最高，延期不阻塞其他价值。

单人工期参考：P1 约 6–8 天 · P2 约 4–5 天 · P3 约 5–6 天 · P4 约 4–5 天 · P5 约 7–9 天。

### P1 — UI 平台重构
范围 = 模块 E 全部（wouter 路由 / TanStack Query / Recharts / token 重建 / 共享组件 / 新 IA），另含后端配套：`/api/subscriptions`、`/api/purchases`、`/api/sales/daily` 增加 `app_id` 过滤（sales 经 `apple_id ↔ apps.asc_app_id` join）；新增 `GET /api/activity`（raw ∪ alert_events 合流分页）；删除收入页事件 segment 残留。

**验收**：刷新/直链保持页面与 App 筛选（URL 含 `?app=`）· 切 tab 二次进入无 loading（缓存命中）、后台切回自动刷新 · 断网/500 出 ErrorState + Toast 可重试，不再显示假「暂无数据」 · 告警 tab 消失且规则可在设置编辑参数与渠道、历史可在动态筛出 · 总览单图口径可切、活跃订阅单一数字带来源徽标 · inline style ≤10 · 首屏 <80KB gz · light-dark 双主题无闪变。

### P2 — 数据健壮性
- **ASSN 全事件解读**（模块 A 事件表粗体项）+ `POST /api/jobs/reprocess`（回放 notifications_raw 分批重建，游标断点）
- **rollup 失真修正**：历史按区间重建（`started_at ≤ dayEnd AND (expires_at IS NULL OR expires_at > dayEnd)`），有 `subs_snapshot_daily` 的日期以快照为准；常规只 rollup 昨日+今日，禁止用当前值覆写历史；REVENUE_EVENTS 口径扩充（+OFFER_REDEEMED、UPGRADE）
- **汇率自动更新**：daily +1 请求 `open.er-api.com/v6/latest/USD`（免费无 key、160+ 币种），fallback jsDelivr `@fawazahmed0/currency-api`；失败沿用上次快照；未知币种按原币入「未折算」桶（数据健康页可见），不再计 0
- **统一预算调度器** `lib/budget.ts`：单次调用 fetch 与 D1 共享计数，作业接收 budget、超支写游标下轮续跑；daily 三件套不再裸串；批量写全部 `db.batch()`
- 杂项：webhook_silent 分 App · channels 生效 · DROP jobs 表 · bad_review_rate 改 created_at · asc/rss 评论关联去重标 canonical · signed_payload 90 天置空 · 对账端点 `GET /api/revenue/reconciliation?days=30`（metrics_daily 事件口径×费率 vs sales_daily proceeds 按日差值%）

**验收**：reprocess 后订阅状态分布与最近 ASC 快照差异 <5%，升降级/退款撤销在时间线正确显示 · 构造 REFUND_REVERSED 后交易恢复计收入 · 断 FX 源 24h 仍用上次快照、未知币种出现在未折算列表而非蒸发 · silent 告警仅绑定 App 静默才触发、规则渠道去掉 push 后不再推送 · observability 验证单次 cron 子请求（含 D1）≤45。

### P3 — 收入深化（依赖 P2）
模块 A 指标口径表 P3 项全部落地：Trial 周 cohort 漏斗、续订率（首续/多续）、Churn（主/被动）、退款率、国家/产品维度切分、三口径切换（proceeds_rate 默认 0.85）、LTV 简版（cohorts weekly 物化，唯一物化项）。

**验收**：每个 KPI 卡带口径 tooltip · 漏斗与手工 SQL 抽验一致 · 口径切换全页数值联动且徽标同步 · 对账卡 30 天差值可解释（费率+汇率+时差）。

### P4 — 口碑闭环（依赖 P1，可与 P3 换序）
评论回复（含角色前置检查与状态机同步）、评分分布（样本口径）、版本对比（app_releases + 发布前后 14 天）。详见模块 B。

**验收**：平台内回复真实评论 ASC 后台可见且 24h 内状态翻转已发布 · 「未回复」筛选计数与列表一致 · 发版后版本对比卡自动出现新版本。

### P5 — ASO 启动（依赖 P2 调度器 + P1 tab 槽位）
模块 C 全部：关键词排名（hourly 12 单元分片、文本定位解析）、榜单快照（6h 班次 + 降采样）、Suggest 联想（weekly）、「增长」tab 上位（动态并入总览入口）、两条 ASO 告警。

**验收**：录入 20 词 × 3 国后 24h 内全部产生首个排名点 · observability 确认 hourly 单次 ≤40 子请求、CPU <10ms · 某词跌出 Top10 触发一次推送 · 90 天前小时级榜单数据被降采样。

### Backlog（不排期）
竞品监控（评分/评论/元数据 diff）· analyticsReports 转化漏斗 · 评论翻译（Workers AI 免费额度）· iOS 17 App Badge 未读数 · 周报 · Slack/飞书/邮件渠道 · .p8 加密存储 · Google Play。

## 八、需求细化方法建议

后续把每个模块细化为可开发需求时，按以下模板展开：

1. **用户故事**：作为独立开发者，我希望「新 1 星评论 5 分钟内推送到手机」，以便及时回复止损。
2. **验收标准**：Given/When/Then 格式（本档第七章每期已给出）。
3. **数据口径表**：每个指标一行（名称/公式/数据源/更新频率/边界情况），见模块 A。
4. **接口依赖确认**：标注依赖的 Apple 接口及限制，非官方接口标记「稳定性风险」（见第二章数据源表「稳定性」列）。
5. **优先级**：MoSCoW 标注，映射 P1–P5。
6. **（v0.3 新增）口径徽标**：每个页面模块设计时必须标注其数据口径徽标（来源 + 新鲜度），无法标注说明口径未定义清楚，退回第 3 步。

---

## 九、部署方案：Cloudflare 免费层

**结论：可行，但预算模型 v0.3 已修正。**

### 技术栈映射

| 平台组件 | Cloudflare 产品 | 免费额度 | 本项目预估用量 |
|---------|----------------|---------|--------------|
| PWA 前端 | Workers Assets | 静态资源免费 | 无压力 |
| Webhook + Dashboard API | Workers | 10 万请求/天，10ms CPU/请求 | 几百～几千/天 |
| 数据库 | D1 (SQLite) | 5 GB 存储，500 万行读/天，10 万行写/天 | 写入几千行/天（P5 后 +330 行/天） |
| 定时任务 | Cron Triggers | **5 个/账号** | 用 4 留 1（见下表） |
| Web Push | Workers + WebCrypto | — | VAPID ES256 原生签发（已实现） |

### 免费层约束与应对（v0.3 修正版）

1. **子请求限制 50/次 —— D1 查询计入**。官方定义：subrequest 包括 Fetch API 调用及对 KV/R2/**D1** 等服务的请求（[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)、[D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)）。v0.2 只统计外部 fetch 的预算模型作废。应对：
   - **统一预算调度器**（P2）：单次调用内 fetch 与 D1 语句共享同一计数器，作业超预算即写游标退出、下轮续跑；
   - **批量写走 `db.batch()`**：一次 batch 计 1 个子请求；
   - daily 档多个作业不再裸串，由调度器按剩余预算依次执行、断点续跑。
2. **10ms CPU/请求 —— 同样适用于 Cron Trigger**（wall-clock 上限 15 分钟，可用于请求间 pacing，但 CPU 时间要省）。应对：JWS 验签走原生 WebCrypto（已实现）；关键词排名解析用文本定位替代全量 JSON.parse；销售报告 gzip TSV 解析如超限再拆分。
3. **Cron 5 个上限** → 用 4 留 1，Worker 内按触发器分发（见预算总表）。
4. **抓取规模上限**：hourly 每次 12 个（词,国）单元 → 关键词监控规模 **词×国 ≤250**；更大规模需 Workers Paid（$5/月，30s CPU + 更高限额），架构无需改动。
5. **通知渠道**：Web Push + Telegram 免费（已实现）；邮件无免费方案不做。
6. **无 LLM 依赖**；评论翻译如需要可选 Workers AI 免费额度（Backlog）。

### Cron 预算总表（子请求含 D1）

| 触发器 | 任务 | 单次预算 |
|--------|------|---------|
| `*/15 * * * *` | 评论 wheel（ASC 含 response 同步 + RSS 轮转）+ 高频告警 | ≤40 |
| `0 * * * *` | ASO wheel：关键词 12 单元 + 榜单（6h 班次）（P5 启用） | ≤40 |
| `0 1 * * *` | 统一预算调度：ratings → sales → FX → rollup → 版本 diff → daily 告警 → 日报 → 清理（超预算断点续跑） | ≤45 |
| `0 3 * * 1` | Suggest 采集 + LTV cohort 物化 + 榜单降采样（P3/P5 启用） | ≤40 |
| （空） | 预留 | — |

### 升级路径

第一个瓶颈预计是关键词监控规模（子请求限制）或 D1 写入；升级 Workers Paid（$5/月）即解除大部分限制，架构无需改动。

---

## 附：v0.2 → v0.3 差异摘要

- **新增**：第三章「现状诊断（as-built）」——差距矩阵 + 前端/后端/免费层三类债务清单，文档从「愿景稿」转为「工程账本」
- **重写**：模块 E Dashboard（新 5 tab IA、口径徽标规则、wouter/TanStack Query/Recharts 选型 ADR、light-dark() token 体系、共享组件清单、四态数据层规范）；第七章阶段规划（P1–P5 依赖图 + 每期验收标准）；第六章数据模型（as-built 基线 + 0002–0005 迁移增量，DROP jobs 决策）
- **修正**：免费层子请求预算模型（D1 计入 50 限制，统一预算调度器 + db.batch 应对）；ASO 抓取规模（200 词×5 国 → 词×国 ≤250）；活跃订阅口径（废除 max() 混合，改快照优先 + 徽标）；差评率窗口（fetched_at → created_at）
- **补全**：模块 A 指标口径表（三口径收入、周 cohort Trial 转化、主/被动 Churn）；ASSN 事件映射（REFUND_REVERSED/UPGRADE/OFFER_REDEEMED 等 8 类新增解读）；模块 B 评论回复状态机与凭证角色要求
- **降档**：analyticsReports、竞品监控、多租户加密移入 Backlog；明确「能即时算的不物化」设计原则
