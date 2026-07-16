# ASO 监控分析平台（ASCMonitor）需求文档

> 版本：v0.2（2026-07-16）
> 前身：《StoreKit 2 监控平台（PWA）方案结论》
> 定位升级：从「订阅收入实时监控」扩展为「一站式 App Store 运营监控与 ASO 分析平台」

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

## 二、总体架构

```text
┌─────────────── 数据源 ───────────────┐
│ ① App Store Server Notifications V2  │ ← 实时订阅/购买事件（Webhook）
│ ② App Store Connect API              │ ← 销售报告 / Analytics / 客户评论
│ ③ iTunes 公开接口（RSS / Search /    │ ← 评分、榜单、搜索联想（定时抓取）
│    Lookup / Suggest）                │
└──────────────────┬───────────────────┘
                   │
        Ingestion 层（Webhook 接收 + 定时任务调度）
                   │
              Backend（事件处理 / 聚合计算 / 告警引擎）
                   │
              Database（原始事件 + 聚合快照 + 时序数据）
                   ├── Dashboard API（REST/GraphQL）
                   └── 通知分发（Web Push / Telegram / Slack / 飞书 / 邮件）
                          │
                    PWA（iPhone / Android / Desktop）
```

### 数据源与获取方式明细

| 数据 | 来源 | 方式 | 频率 |
|------|------|------|------|
| 订阅/一次性购买/退款事件 | ASSN V2 | Webhook 推送 | 实时（秒级） |
| 免费下载量 | ASC 销售报告（无实时通知） | 定时拉取 | 每日 |
| 交易明细与历史 | App Store Server API | 拉取（JWS 验证） | 事件触发 |
| 销售与下载报告 | ASC API `salesReports` | 定时拉取 | 每日 |
| 页面浏览/转化率/来源 | ASC API `analyticsReports` | 定时拉取 | 每日 |
| 客户评论（可回复） | ASC API `customerReviews` | 定时拉取 | 每 15 分钟～1 小时 |
| 各国评分/评论（含竞品） | iTunes RSS `customerreviews` + Lookup | 定时抓取 | 每小时 |
| 榜单排名 | iTunes RSS 榜单接口 | 定时抓取 | 每小时 |
| 关键词排名 | iTunes Search API（按国家/语言模拟搜索） | 定时抓取 | 每日 |
| 搜索联想词 | App Store Suggest 接口 | 定时抓取 | 每周 |
| 竞品元数据（截图/描述/版本） | iTunes Lookup | 定时抓取 + diff | 每日 |

> 注意：公开接口有频率限制与非官方稳定性风险，需要抓取队列 + 退避重试 + 结果缓存；关键词排名抓取要控制在合理规模（如 ≤200 词 × 5 国家）。

## 三、功能模块细化

### 模块 A：收入与订阅监控（原方案，细化）

**核心指标（每个指标需有明确定义与计算口径）：**

| 指标 | 定义口径 | 粒度 |
|------|---------|------|
| 今日收入 | 当日 `SUBSCRIBED`/`DID_RENEW`/一次性购买净额（扣除退款），按 proceeds 或 customer price 可切换 | 实时 |
| MRR / ARR | 活跃订阅按月度化价格折算求和；年订阅 ÷ 12 | 每日快照 |
| 活跃订阅数 | 处于 `active` + `grace period` 的订阅数 | 实时 |
| Trial 转化率 | 同 cohort 内 Trial → 付费的比例（按开始试用周分组） | 每日 |
| 续订率 | 到期应续订中实际续订的比例，按订阅时长分层（首次续订 vs 多次） | 每日 |
| 退款率 | 退款笔数 / 成交笔数，滚动 30 天 | 每日 |
| Churn | 主动取消 + 被动流失（Billing Retry 失败），分开统计 | 每日 |
| LTV | 按 cohort 的累计收入 / 用户数 | 每周 |

**事件流（映射 ASSN V2 notificationType + subtype）：**

| 平台事件 | ASSN V2 来源 |
|---------|--------------|
| 一次性内购（消耗型/非消耗型/非续订） | `ONE_TIME_CHARGE`（2025 年起生产可用） |
| 新订阅 | `SUBSCRIBED` + `INITIAL_BUY` |
| 重新订阅 | `SUBSCRIBED` + `RESUBSCRIBE` |
| 自动续费 | `DID_RENEW` |
| 升级/降级 | `DID_CHANGE_RENEWAL_PREF` + `UPGRADE`/`DOWNGRADE` |
| 取消自动续费 | `DID_CHANGE_RENEWAL_STATUS` + `AUTO_RENEW_DISABLED` |
| 计费重试 | `DID_FAIL_TO_RENEW` |
| 宽限期 | `DID_FAIL_TO_RENEW` + `GRACE_PERIOD` |
| 过期 | `EXPIRED`（含 subtype 区分原因） |
| 退款 | `REFUND` / `REFUND_DECLINED` / `REFUND_REVERSED` |
| 价格上调同意 | `PRICE_INCREASE` |
| 优惠兑换 | `OFFER_REDEEMED` |

**用户生命周期视图：**
Trial → Paid → Renew(×N) → (Grace Period → Billing Retry) → Expired / Resubscribe
每个订阅可展开完整事件时间线。

**维度切分：** 产品 / 国家地区 / 订阅时长档位 / 获客 cohort / 优惠类型。

### 模块 B：评分与评论监控（新增）

**B1 评分监控**
- 各国家/地区评分（均分 + 评分数），每日快照，趋势曲线
- 评分分布（1–5 星占比）变化
- 版本发布前后评分对比（新版本是否拉低评分）
- 加权总评分变化预测（新增 N 个 5 星可提升多少）

**B2 评论监控**
- 全球评论聚合流：国家、星级、版本、时间、原文（翻译可接免费翻译接口，可选）
- 新评论实时推送（可按星级过滤，如「仅 1–2 星立即通知」）
- 评论回复：通过 ASC API 直接在平台内回复（含回复状态追踪）
- 评论标签：基于关键词规则自动打标（如包含 crash/闪退 → 崩溃，包含 price/太贵 → 价格抱怨），规则可自行维护，星级本身即天然的情感信号
- 关键词云与主题趋势：基于词频统计，看本周抱怨最多的问题是什么
- 差评预警：差评率突增（如 24h 内 1 星占比 > 阈值）触发告警

**B3 竞品评论**
- 追踪竞品评论流，同样做标签与词频统计
- 「竞品差评 = 我的机会」视图：竞品被抱怨最多的功能点

### 模块 C：ASO 分析（新增）

**C1 关键词追踪**
- 关键词库管理：手动添加 + 从元数据/竞品/联想词自动推荐
- 每日各国排名追踪：排名曲线、进入/跌出 Top 10/50/100 事件
- 关键词覆盖分析：当前 title/subtitle/keywords 字段覆盖了哪些词、浪费了哪些字符
- 搜索联想挖掘：基于种子词抓取 App Store 联想词，评估相关性

**C2 榜单排名**
- 分类榜/总榜排名（免费/付费/畅销），各国家每小时快照
- 排名突变告警（被推荐、被下架、竞品冲榜）

**C3 元数据与转化**
- 产品页转化率（Impressions → Product Page View → Download），来源拆分（搜索/浏览/推荐/外部）
- 自身元数据版本历史：每次修改截图/描述/关键词自动存档，与转化率曲线叠加对比（近似 A/B 分析）
- 应用内活动（In-App Events）与 PPO/CPP 效果追踪（后期）

**C4 竞品监控**
- 竞品清单管理（每个自有 App 关联 N 个竞品）
- 竞品变更 diff：价格、截图、描述、版本更新（What's New 存档）、订阅定价
- 竞品榜单/评分对比面板

### 模块 D：告警与通知

**通知渠道：** Web Push（MVP）→ Telegram / Slack / 飞书 / 邮件（Phase 2）

**告警规则引擎（用户可配置：指标 + 条件 + 窗口 + 渠道 + 静默期）：**

| 类别 | 示例规则 |
|------|---------|
| 收入 | 今日收入低于 7 日均值 30%；单笔大额退款 |
| 订阅 | 1 小时内取消订阅 > N；Billing Retry 激增 |
| 评论 | 新 1 星评论；24h 差评率 > 20%；评论提及「crash」 |
| ASO | 核心关键词跌出 Top 10；榜单排名下跌 > 50 位 |
| 竞品 | 竞品发新版本；竞品改价 |
| 系统 | ASSN Webhook 静默超过 N 小时（数据管道自检） |

**每日/每周摘要推送：** 收入 + 评分 + 排名变化的日报卡片。

### 模块 E：Dashboard（PWA）

- 首页总览：今日收入、MRR、活跃订阅、今日评分/评论数、核心词排名变化，多 App 切换
- 各模块专属页面 + 全局时间范围/国家筛选器
- iOS 16.4+ Web Push、iOS 17+ Badge（未读告警数）
- 移动端优先设计（开发者随时掏出手机看一眼）

## 四、非功能性需求

| 项 | 要求 |
|----|------|
| 多租户 | 支持多个 ASC 账号 / 多 App；API Key（.p8）加密存储 |
| 安全 | ASSN V2 签名（JWS x5c 链）验证；ASC Token 按需签发；敏感数据加密 |
| 可靠性 | Webhook 幂等处理（notificationUUID 去重）；抓取任务失败重试 + 死信队列 |
| 数据保留 | 原始事件永久保留；小时级快照保留 90 天，之后降采样为日级 |
| 时区 | 统一 UTC 存储，展示层按用户时区/App Store 财务日切换 |
| 抓取合规 | 公开接口限速、缓存、UA 标识；关键词抓取规模可配置上限 |

## 五、数据模型概要

核心表（略去字段细节，实施时细化）：

- `apps` / `tenants` / `asc_credentials`
- `subscription_events`（ASSN 原始事件，append-only）
- `subscriptions`（订阅当前状态物化视图）
- `revenue_daily` / `metrics_snapshots`（聚合快照）
- `reviews` / `review_replies` / `review_tags`
- `ratings_snapshots`（按国家每日）
- `keywords` / `keyword_rankings`（时序）
- `chart_rankings`（时序）
- `competitors` / `competitor_snapshots`（元数据 diff）
- `alert_rules` / `alert_events` / `push_subscriptions`

## 六、阶段规划

### Phase 1 — 订阅监控 MVP（原方案范围）
1. ASSN V2 Webhook 接收 + 验签 + 事件入库
2. 收入/订阅核心指标（今日收入、MRR、活跃订阅、事件流）
3. PWA Dashboard 首页 + 事件时间线
4. Web Push 基础通知（新订阅/退款）

### Phase 2 — 口碑监控
5. ASC 评论拉取 + 评论流 + 评论回复
6. 评分快照与趋势
7. 评论关键词标签与词频统计
8. 差评告警 + 告警规则引擎 v1

### Phase 3 — ASO 分析
9. 关键词库 + 排名追踪
10. 榜单排名追踪
11. Analytics API 转化数据接入
12. 元数据历史存档

### Phase 4 — 竞品与增强
13. 竞品监控（评分/评论/元数据 diff）
14. 多渠道通知（Telegram/Slack/飞书）
15. 日报/周报、LTV/cohort 深度分析
16. （评估）Google Play 支持、原生 App/Widget

## 七、需求细化方法建议

后续把每个模块细化为可开发的需求，建议按以下模板逐条展开：

1. **用户故事**：作为独立开发者，我希望「新 1 星评论 5 分钟内推送到手机」，以便及时回复止损。
2. **验收标准**（示例）：
   - Given 某国家出现新 1 星评论，When 抓取任务运行，Then 15 分钟内产生一条告警且 Push 送达
   - 评论去重：同一评论更新（用户改评分）应更新而非新增
3. **数据口径表**：每个指标一行（名称/公式/数据源/更新频率/边界情况），避免「收入」这种词在不同页面口径不一致。
4. **接口依赖确认**：每条需求标注依赖的 Apple 接口及其限制（配额、延迟、是否官方），公开接口需求单独标记「稳定性风险」。
5. **优先级**：MoSCoW（Must/Should/Could/Won't）标注，映射到上面四个 Phase。

---

## 八、部署方案：Cloudflare 免费层

**结论：可行。** 独立开发者规模（几个 App、每日几百个订阅事件、几千次抓取）远低于免费额度。

### 技术栈映射

| 平台组件 | Cloudflare 产品 | 免费额度（2026-07 确认） | 本项目预估用量 |
|---------|----------------|------------------------|--------------|
| PWA 前端 | Pages / Workers Assets | 静态资源免费 | 无压力 |
| Webhook + Dashboard API | Workers | 10 万请求/天，10ms CPU/请求 | 几百～几千/天 |
| 数据库 | D1 (SQLite) | 5 GB 存储，500 万行读/天，10 万行写/天 | 写入几千行/天 |
| 定时抓取/聚合 | Cron Triggers | **5 个/账号（免费层）** | 见下方调度设计 |
| 缓存/去重 | KV | 10 万读/天，1 千写/天 | 可用 D1 替代大部分 |
| Web Push | Workers + WebCrypto | — | VAPID JWT（ES256）用原生 WebCrypto 签发 |

### 免费层约束与应对

1. **Cron Triggers 只有 5 个** → 按频率分档：`*/15min`、`hourly`、`daily`、`weekly` 共 4 个触发器，Worker 内部用 D1 任务表分发具体作业（评论抓取、榜单快照、报告拉取……）。
2. **每次调用最多 50 个子请求** → 抓取任务分片：任务表记录游标，每次 cron 只处理一批（如 40 个关键词），下个周期继续。关键词 × 国家的规模需据此设上限（如每日 200 词 × 5 国 = 1000 次请求，分 25 批完成，完全够用）。
3. **10ms CPU/请求** → ASSN V2 的 JWS 验签走原生 WebCrypto（不计入多少 CPU 时间），够用；销售报告的 gzip TSV 解析如超限，可拆分处理或申请付费层（$5/月即 30s CPU）。
4. **Queues 免费额度很少/受限** → 不用 Queues，用 D1 任务表 + cron 轮询实现队列语义（含重试计数、死信标记），免费且够用。
5. **通知渠道** → Web Push 免费；邮件在 Workers 上无免费方案，优先 Telegram Bot / 飞书 Webhook（均免费）。
6. **LLM/翻译** → 已移除 LLM 依赖；翻译如需要可用 Workers AI 免费额度（可选项）。

### 升级路径

数据量增长后第一个碰到的瓶颈预计是 D1 写入（10 万行/天）与 Worker 请求数；届时升级 Workers Paid（$5/月）即解除大部分限制，架构无需改动。

---

## 附：与原文档的差异摘要

- 新增：评分/评论监控、ASO 关键词与榜单、竞品监控、告警规则引擎、数据模型、非功能需求
- 细化：指标定义口径、ASSN V2 事件映射、数据源获取方式与频率
- 保留：PWA 技术选型结论、StoreKit 2 边界定位、原 MVP（并入 Phase 1）
