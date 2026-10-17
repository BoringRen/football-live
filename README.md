# Football Live · 五大联赛实时数据台

基于 **5DollarFootballAPI** 设计的纯前端实时数据看板。无需构建工具、无第三方依赖，
双击 `index.html` 就能看到完整效果（内置演示数据，自动模拟比赛推进）。

---

## 一、能做什么

| 模块 | 说明 |
|---|---|
| 实时赛事 | 五大联赛赛程/比分卡片，进行中比赛高亮并显示分钟数、角球、红黄牌、1X2 即时赔率 |
| 技术统计 | 控球、射门、射正、角球、危险进攻、犯规、牌面等双边对比条 |
| 盘口赔率 | 1X2 / 亚盘 / 大小球 / 角球盘口 / 红黄牌盘口 / 双方进球，展示开赔 → 即时 → 变动幅度 |
| 赔率走势 | 按盘口切换的赔率变动折线图（手绘 SVG，无图表库），标注每个选项的当前值 |
| 事件时间线 | 进球、黄牌、红牌的分钟级事件流 |
| 积分榜 | 积分榜 / 角球榜 / 红黄牌榜三视图，带欧冠区、欧联区、降级区标记 |
| 赔率变动监控 | 全联赛扫一遍，按开赔与即时的最大偏离度排序，一眼看出异动比赛 |

**自动化**：页面自带走马灯时钟、刷新倒计时、自动轮询、配额水位条、骨架屏与错误横幅。

---

## 二、两种运行模式

### 1. 演示模式（默认，开箱即用）

不带 API Key 时自动启用 `assets/mock.js`：生成 30 场五大联赛比赛，
每 8 秒推进一次（分钟数增长、随机进球/角球/牌、赔率漂移），
统计、盘口、走势、事件、积分榜全部由同一套数据推导，逻辑自洽。

### 2. 真实 API 模式

点右上角「设置」，填入 Key 即可切换。Key 获取：<https://5dollarfootballapi.com> 免费注册，无需信用卡。

```
Base URL: https://api.5dollarfootballapi.com/v1
Key     : fb_xxxxxxxxxxxxxxxx
```

> **CORS 提醒**：浏览器直连第三方 API 大概率被跨域拦截（官方文档也明确不建议把 Key 放在客户端）。
> 若控制台报跨域，请自建一层反向代理，然后把「Base URL」改成代理地址，例如：
>
> ```js
> // Vercel / Netlify rewrite 示例
> { "rewrites": [{ "source": "/api/:path*", "destination": "https://api.5dollarfootballapi.com/v1/:path*" }] }
> ```
>
> 代理侧再注入 `Authorization: Bearer <key>`，前端就完全不用接触密钥。

---

## 三、配额策略（重要）

免费层 **60 次请求 / 小时**，且**每分钟最多 20 次突发**（`/status` 实测返回
`rate_limit: 60, rate_window_seconds: 3600, burst_per_minute: 20`）。本项目的对应设计：

- 每次请求都记账到 `localStorage`，按滚动 1 小时统计已用量
- 顶部水位条实时显示剩余额度，低于 6 次变红、低于 18 次变黄
- 额度耗尽前**主动拦截**，不发请求，避免白吃 429
- 刷新间隔默认 300 秒（约 12 次/小时），设置里可选 30s / 60s / 120s / 300s
- 详情页的统计、盘口、走势、事件均为**点击后按需加载 + 内存缓存**，不随轮询消耗额度

换算参考：列表轮询 300 秒 = 12 次/小时，剩余 48 次留给详情页点击与手动刷新，
正常浏览、看几场比赛的盘口都够用。如果只挂着看比分、不点详情，120 秒也可以。

---

## 四、目录结构

```
football-live/
├── index.html          页面结构（顶栏、三视图、详情抽屉、设置弹窗）
├── proxy.js            零依赖静态服务 + API 反向代理 + 密钥注入
├── assets/
│   ├── style.css       设计令牌与全部样式（浅色主题，响应式）
│   ├── mock.js         演示数据生成器 + 实时模拟
│   ├── api.js          API 客户端（鉴权、配额、字段归一化）
│   └── ui.js           渲染与交互（列表、抽屉、图表、榜单、监控）
├── test.js             jsdom 渲染自检脚本
└── README.md
```

---

## 五、真实接口实测字段（2026-10-17 用真实 Key 核对）

这一节是**实测出来的**，不是文档推测。上线前照这个对，能省掉大部分调试。

### 1. 联赛 ID 是自定义的，不是 API-Football 那套

网上很多资料会告诉你英超是 `39`、西甲 `140`——**在这家 API 上全错**，传 `league=39` 会直接 404。
真实值（`GET /leagues` 可查）：

| 联赛 | id |
|---|---|
| England Premier League | `4160026622` |
| Spain La Liga | `4212821298` |
| Germany Bundesliga I | `686337048` |
| Italy Serie A | `3405541143` |
| France Ligue 1 | `3614399544` |

接口返回的 `league.name` 是英文，前端用 `LEAGUE_CN` 映射成中文简称。

### 2. 时间是 unix 秒，窗口最多 24 小时

```
GET /fixtures?start_time=1792201687&end_time=1792288087&per_page=100
```

- `date=2026-10-18` → 400 `unknown_parameter`，提示改用 `start_time/end_time`
- 跨度超过 24 小时 → 400 `invalid_time_window: The window may span at most 24 hours`
- 前端默认取 `now-6h ~ now+18h`，一次请求覆盖当日全部赛程

### 3. status 只有三个值

`scheduled` / `live` / `finished`，完场时 `status_code: "full"`。
`live` 时**没有分钟数字段**，前端按 `kickoff_ts` 推算（45 分钟处封顶到 90，避免半场虚高）。

### 4. fixture 载荷结构

```json
{
  "id": 2836579409,
  "league": { "id": 4160026622, "name": "England Premier League" },
  "teams": { "home": {"id":761437401,"name":"Everton"}, "away": {"id":3399423062,"name":"Chelsea"} },
  "kickoff_utc": "2026-10-17T11:30:00+00:00",
  "kickoff_ts": 1792236600,
  "status": "scheduled",
  "goals":   { "home": 0, "away": 0, "half_home": 0, "half_away": 0 },
  "corners": { "home": 0, "away": 0, "half_home": 0, "half_away": 0 },
  "cards":   { "home": {"yellow":0,"red":0}, "away": {"yellow":0,"red":0} }
}
```

注意：**列表接口不内嵌赔率**，所以赛事卡片上的 1X2 是空的，赔率只能在详情里单独取。

### 5. 盘口的嵌套是 bookmakers → odds → 市场 key

```json
{"data": {"fixture_id": 2836579409, "bookmakers": [{
  "name": "Bet 365", "slug": "bet365",
  "odds": {
    "1x2":  {"opening": {"home":3.1,"draw":3.5,"away":2.15},
             "closing": {"home":3.0,"draw":3.8,"away":2.2},
             "inplay": null},
    "asian_handicap": {"opening": {"line":0.25,"home":1.95,"away":1.9}, "closing": {...}, "inplay": null},
    "goal_line": {"opening": {"line":2.75,"over":2.0,"under":1.85}, ...}
  }
}]}}
```

支持的市场 key（下划线命名，共 12 个）：

`1x2`、`asian_handicap`、`goal_line`、`goal_line_fixed`、`corner_line`、`corner_asian`、
`card_line`、`card_asian`、`btts`、`asian_handicap_half`、`goal_line_half`、`corner_line_half`

当前值取 `inplay ?? closing ?? opening`，开赔取 `opening`。带 `line` 的市场会把盘口线拼进选项名，
例如「大 +3」「主 +0.25」，这样盘口变动时不会看不出让球数变了。

### 6. 赔率变动历史要 Ultra 套餐

```
GET /fixtures/{id}/odds/history   →  403 insufficient_plan
```

免费层拿不到，前端不造假数据，直接显示「需要更高套餐」并附 `request_id`。
`/fixtures/{id}/odds` 本身是免费的，能拿到开赔与即时值——**只有"逐笔变动时间序列"收费**。

### 7. 统计、事件、榜单的包体都在 `data` 里再套一层

```
/fixtures/{id}/statistics → data.statistics   { attacks, dangerous_attacks, shots_on_target,
                                                shots_off_target, possession, first_half{...} }
/fixtures/{id}/events     → data.events[]     { type, minute, team, count, period, score }
/standings                → data.table[]      { position, team{id,name}, played, win, draw, lose,
                                                goals_for, goals_against, goal_difference, points }
```

- 事件 `type`：`corner` / `yellow_card` / `red_card` / `goal` / `period_score`
- 角球榜、牌面榜同样是 `data.table[]`，但字段换成 `total_for` / `total_against` / `average_for`，
  牌面榜的 `yellow` 和 `red` 是 `{total, average}` 对象，**不是数字**
- 统计接口在未开赛时返回全 0 的对象，前端识别后显示「暂无统计数据」而不是一排 0
- `standings` 不传 `type` 默认 `total`；角球传 `corner`，红黄牌传 `card`

### 8. 错误结构

```json
{"success":0,"error":{"type":"authentication_error","code":"invalid_api_key",
 "message":"...","param":"...","doc_url":"...","request_id":"req_xxx"}}
```

`api.js` 的 `request()` 会把 `invalid_api_key` / `insufficient_plan` / `unknown_parameter` /
`invalid_time_window` / 429 分别翻成中文提示，未知错误也会把 `request_id` 带出来。

已封装的端点：

```
GET /fixtures                        fixtures({leagueId, status, startTime, endTime})
GET /fixtures/{id}                   fixture(id)
GET /fixtures/{id}/statistics        statistics(id)
GET /fixtures/{id}/odds              odds(id, market)
GET /fixtures/{id}/odds/history      oddsHistory(id, market)      ← Ultra 限定
GET /fixtures/{id}/events            events(id)
GET /standings                       standings(leagueId, 'points'|'corner'|'card')
```

`FD.api` 全部方法返回 Promise，可在控制台直接调；`FD.debug.state` 能看内部状态。

---

## 六、实时接入：本地代理（推荐）

`proxy.js` 一个文件同时干三件事：静态托管、`/api/*` 反向代理、密钥注入。
零依赖，只用 Node 内置模块，浏览器端拿到的是同源请求，**CORS 问题消失、密钥不出服务端**。

```bash
# 1) 先去 https://5dollarfootballapi.com 免费注册拿 Key（无需信用卡）
# 2) 起服务（Key 换成你自己的）
node proxy.js --key=fb_xxxxxxxx
#    或：FD_KEY=fb_xxxxxxxx node proxy.js
#    换端口：node proxy.js --key=fb_xxx --port=8787

# 3) 打开 http://127.0.0.1:8787/
```

启动后页面的行为：

- 顶部徽章变成 **「实时 API · 代理」**，数据源切到真实接口
- 设置弹窗里 **Key 与 Base URL 都置灰**（由服务端注入，前端不该也不能持有）
- 每次转发在终端打一行日志，含上游状态码与剩余配额：

```
[15:39:44] OK   /fixtures?league=39 → 200 (18234B) 剩余 57
[15:40:02] FAIL /fixtures/123/odds → 429 (98B)
```

**没配 Key 时不会白屏**：代理不注入代理地址，前端照常退回演示模式，
所以 `node proxy.js` 裸跑也能当普通静态服务器用。

### 已验证的上游行为

用一枚无效 Key 打 `GET /api/status`，上游真实返回：

```json
{
  "success": 0,
  "error": {
    "type": "authentication_error",
    "code": "invalid_api_key",
    "message": "The API key is invalid or has been revoked.",
    "doc_url": "https://5dollarfootballapi.com/docs/errors#invalid_api_key",
    "request_id": "req_yvhsje8xuc7c"
  }
}
```

说明接口确实在线、鉴权链路正常，错误结构是 `{success, error:{type, code, message, doc_url, request_id}}`
（成功时是 `{success, data}`）。`request_id` 提工单时会被要求带上。

---

## 七、合规

免费层（Free / Community / Education）用于**公开产品时必须署名**，本项目已在页脚保留：

> Football data by [5DollarFootballAPI](https://5dollarfootballapi.com)

另按官方条款，不得把原始数据当作竞品数据源转售或再分发。
本页面仅做只读展示，数据不做落地存储。
