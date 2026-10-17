/* =========================================================
   api.js —— 5DollarFootballAPI 客户端 + 归一化层
   Base: https://api.5dollarfootballapi.com/v1
   鉴权: Authorization: Bearer <key>

   设计要点：
   1. 所有字段取值都走多路径 pick()，因为官方未公开完整字段表，
      不同端点/套餐返回细节会有差异，容错优先。
   2. 请求配额按「滚动 1 小时」记录在 localStorage，免费层 60 次/小时，
      超额前主动拦截，避免白白吃 429。
   3. 归一化后的模型与 mock.js 完全一致，UI 无需区分数据来源。
   ========================================================= */
(function (global) {
  'use strict';

  var FD = global.FD = global.FD || {};

  var LS = {
    key: 'fd.key',
    base: 'fd.base',
    // 加了 .v2 后缀：让此前已保存的 120 秒旧值失效，改用新的 300 秒默认
    interval: 'fd.interval.v2',
    auto: 'fd.auto',
    quota: 'fd.quota'
  };

  /* 存储降级：file:// 协议或隐私模式下 localStorage 可能直接抛异常，
     此时退回内存存储，页面功能不受影响（仅刷新后配置不保留）。 */
  var store = (function () {
    try {
      var raw = window['localStorage'];
      var probe = '__fd_probe__';
      raw.setItem(probe, '1');
      raw.removeItem(probe);
      return raw;
    } catch (e) {
      var mem = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; }
      };
    }
  })();

  var DEFAULT_BASE = 'https://api.5dollarfootballapi.com/v1';
  var HOURLY_LIMIT = 60;

  /* 内置密钥：GitHub Pages 这类纯静态托管没有服务端，无法藏 Key，
     只能写在前面直连上游（已确认上游 Access-Control-Allow-Origin: *，
     且预检放行 authorization 头）。
     ⚠️ 仓库是公开的，这个 Key 等同公开。免费层 60 次/小时，被刷就没得用。
     优先级：设置里手动填的 Key > 内置 Key。 */
  var BUILTIN_KEY = 'fb_live_UysbtYOJXeexgMMjuGTwxAll7VLlIJAG';

  /* 代理基址，动态读取（而非加载时快照）：
     - 本地 node proxy.js 会在 <head> 里服务端注入 window.__FD_PROXY_BASE__="/api"
     - index.html 里的探测脚本在确认存在 /api 代理后也会设置它
     - 动态读取是为了兼容「探测异步完成」的时序：哪怕稍晚设置，下一次请求也能感知 */
  function proxyBase() { return global.__FD_PROXY_BASE__ || ''; }

  /* ---------------- 配置 ---------------- */
  var config = {
    key: store.getItem(LS.key) || BUILTIN_KEY,
    base: proxyBase() || store.getItem(LS.base) || DEFAULT_BASE,
    // 默认 300 秒（12 次/小时）：免费层 60 次/小时，留足余量给详情页点击
    interval: parseInt(store.getItem(LS.interval) || '300', 10),
    auto: store.getItem(LS.auto) !== '0'
  };

  function saveConfig(patch) {
    Object.keys(patch).forEach(function (k) { config[k] = patch[k]; });
    if (!config.key) config.key = BUILTIN_KEY;    // 设置里留空 → 回落到内置 Key，不会把自己搞失效
    if (proxyBase()) config.base = proxyBase();   // 代理模式下不允许改 base
    store.setItem(LS.key, config.key);
    store.setItem(LS.base, config.base);
    store.setItem(LS.interval, String(config.interval));
    store.setItem(LS.auto, config.auto ? '1' : '0');
  }

  /* ---------------- 配额 ---------------- */
  function readQuota() {
    var arr = [];
    try { arr = JSON.parse(store.getItem(LS.quota) || '[]'); } catch (e) { arr = []; }
    var cut = Date.now() - 3600e3;
    arr = arr.filter(function (t) { return t > cut; });
    store.setItem(LS.quota, JSON.stringify(arr));
    return arr;
  }
  function usedQuota() { return readQuota().length; }
  function remainingQuota() { return Math.max(0, HOURLY_LIMIT - usedQuota()); }
  function markQuota() {
    var arr = readQuota();
    arr.push(Date.now());
    store.setItem(LS.quota, JSON.stringify(arr));
  }

  /* ---------------- 请求 ---------------- */
  function buildUrl(path, params) {
    var url = config.base.replace(/\/+$/, '') + path;
    if (params) {
      var qs = [];
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === undefined || v === null || v === '') return;
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      if (qs.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
    }
    return url;
  }

  function ApiError(message, code, hint) {
    this.name = 'ApiError';
    this.message = message;
    this.code = code || 0;
    this.hint = hint || '';
  }
  ApiError.prototype = Object.create(Error.prototype);

  function request(path, params) {
    if (!config.key && !proxyBase()) {
      return Promise.reject(new ApiError('未配置 API Key', 0, '请在「设置」中填入 Key，或使用演示数据。'));
    }
    if (remainingQuota() <= 0) {
      return Promise.reject(new ApiError(
        '已达免费配额上限',
        429,
        '5DollarFootballAPI 免费层为 60 次/小时，当前窗口已用尽，请稍后再试或调大刷新间隔。'
      ));
    }

    var url = buildUrl(path, params);
    markQuota();

    var headers = { 'Accept': 'application/json' };
    if (config.key && !proxyBase()) headers['Authorization'] = 'Bearer ' + config.key;

    return fetch(url, {
      method: 'GET',
      headers: headers,
      cache: 'no-store'
    }).then(function (res) {
      if (res.ok) return res.json();
      // 把上游的结构化错误 {success:0, error:{type, code, message, request_id}} 转成人话
      return res.json().catch(function () { return null; }).then(function (body) {
        var e = (body && body.error) || {};
        var code = e.code || '';
        if (code === 'insufficient_plan') {
          throw new ApiError('需要更高套餐', 403,
            '该接口（如赔率变动历史）仅 Ultra 套餐可用，免费层不开放。request_id ' + (e.request_id || '—'));
        }
        if (code === 'invalid_api_key') {
          throw new ApiError('API Key 无效', 401, '请检查 Key 是否正确，或到官网重新生成。');
        }
        if (code === 'unknown_parameter' || code === 'invalid_time_window') {
          throw new ApiError('请求参数不合法', 400, e.message || '');
        }
        if (res.status === 429 || code === 'rate_limit_exceeded') {
          // 从响应头读额度重置时间（unix 秒），供前端做退避，避免反复撞限流
          var resetSec = parseInt(res.headers.get('x-ratelimit-reset') || '', 10);
          var err429 = new ApiError('请求过于频繁', 429, '免费层 60 次/小时，请调大刷新间隔。');
          if (resetSec) err429.resetTs = resetSec * 1000;
          throw err429;
        }
        throw new ApiError(e.message || ('接口返回 ' + res.status), res.status,
          (code ? code + ' · ' : '') + 'request_id ' + (e.request_id || '—'));
      });
    }).catch(function (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        '网络请求失败（可能是 CORS 拦截）',
        0,
        '浏览器直连第三方 API 常被 CORS 挡住。请在「设置」里把 Base URL 换成本地反向代理，例如 ' +
        'vercel/netlify 的 rewrite，或本地 node 代理指向 ' + DEFAULT_BASE
      );
    });
  }

  /* ---------------- 取值容错 ---------------- */
  function pick(obj, paths, dflt) {
    for (var i = 0; i < paths.length; i++) {
      var cur = obj, ok = true;
      var parts = paths[i].split('.');
      for (var j = 0; j < parts.length; j++) {
        if (cur === null || cur === undefined || typeof cur !== 'object' || cur[parts[j]] === undefined) {
          ok = false; break;
        }
        cur = cur[parts[j]];
      }
      if (ok && cur !== null && cur !== undefined) return cur;
    }
    return dflt;
  }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function payload(json) {
    if (!json) return null;
    if (Array.isArray(json)) return json;
    if (json.data !== undefined) return json.data;
    if (json.response !== undefined) return json.response;
    return json;
  }

  /* ---------------- 状态映射 （本 API 用 scheduled / live / finished） ---------------- */
  var STATUS_MAP = {
    SCHEDULED: ['upcoming', '未开始'], NS: ['upcoming', '未开始'], TBD: ['upcoming', '待定'],
    LIVE: ['live', '进行中'], '1H': ['live', '上半场'], '2H': ['live', '下半场'], HT: ['live', '中场'],
    ET: ['live', '加时'], BT: ['live', '加时休息'], P: ['live', '点球'],
    SUSP: ['live', '暂停'], INT: ['live', '中断'],
    FINISHED: ['finished', '已结束'], FT: ['finished', '完场'], AET: ['finished', '加时完'], PEN: ['finished', '点球完'],
    PST: ['other', '推迟'], CANC: ['other', '取消'], ABD: ['other', '腰斩'],
    AWD: ['finished', '判负'], WO: ['finished', '弃权']
  };
  function mapStatus(code, elapsed) {
    var c = String(code || '').toUpperCase();
    var hit = STATUS_MAP[c] || ['other', c || '—'];
    return { bucket: hit[0], label: hit[1], code: c, minute: elapsed || 0 };
  }

  /* ---------------- 联赛中英映射（接口返回英文名） ---------------- */
  var LEAGUE_CN = {
    4160026622: '英超', 4212821298: '西甲', 686337048: '德甲',
    3405541143: '意甲', 3614399544: '法甲'
  };
  function leagueName(id, fallback) {
    return LEAGUE_CN[id] || fallback || '赛事';
  }

  /* ---------------- 球队英中映射（接口返回英文名，这里转成中文） ----------------
     覆盖五大联赛常见球队。英文名以接口实际返回值为准（如 Man City、Inter Milan、
     Athletic Club 等缩写/惯用名），映射不到时原样返回英文，不强行猜。 */
  var TEAM_CN = {
    // 英超
    'Man City': '曼城', 'Arsenal': '阿森纳', 'Liverpool': '利物浦', 'Chelsea': '切尔西',
    'Man United': '曼联', 'Newcastle': '纽卡斯尔', 'Aston Villa': '阿斯顿维拉',
    'Tottenham': '热刺', 'Brighton': '布莱顿', 'Fulham': '富勒姆', 'Brentford': '布伦特福德',
    'Everton': '埃弗顿', 'Ipswich': '伊普斯维奇', 'Hull': '赫尔城', 'Wolves': '狼队',
    'Crystal Palace': '水晶宫', 'West Ham': '西汉姆联', 'Bournemouth': '伯恩茅斯',
    'Nottingham Forest': '诺丁汉森林', 'Leicester': '莱斯特城', 'Southampton': '南安普顿',
    // 西甲
    'Real Madrid': '皇家马德里', 'Barcelona': '巴塞罗那', 'Atletico Madrid': '马德里竞技',
    'Athletic Club': '毕尔巴鄂竞技', 'Real Betis': '皇家贝蒂斯', 'Villarreal': '比利亚雷亚尔',
    'Valencia': '巴伦西亚', 'Espanyol': '西班牙人', 'Elche': '埃尔切',
    'Real Sociedad': '皇家社会', 'Sevilla': '塞维利亚', 'Girona': '赫罗纳',
    'Celta Vigo': '塞尔塔', 'Getafe': '赫塔费', 'Osasuna': '奥萨苏纳', 'Mallorca': '马略卡',
    'Rayo Vallecano': '巴列卡诺', 'Alaves': '阿拉维斯', 'Leganes': '莱加内斯',
    'Las Palmas': '拉斯帕尔马斯', 'Valladolid': '巴拉多利德',
    // 德甲
    'Bayern Munich': '拜仁慕尼黑', 'Borussia Dortmund': '多特蒙德', 'RB Leipzig': 'RB莱比锡',
    'Bayer Leverkusen': '勒沃库森', 'VfB Stuttgart': '斯图加特', 'Union Berlin': '柏林联合',
    'Schalke': '沙尔克04', 'Hamburg': '汉堡', 'Paderborn': '帕德博恩',
    'Elversberg': '埃沃斯堡', 'Mainz': '美因茨', 'Augsburg': '奥格斯堡',
    'Werder Bremen': '云达不莱梅', 'Eintracht Frankfurt': '法兰克福', 'Freiburg': '弗赖堡',
    'Hoffenheim': '霍芬海姆', 'Wolfsburg': '沃尔夫斯堡', 'Monchengladbach': '门兴格拉德巴赫',
    'FC Koln': '科隆', 'Heidenheim': '海登海姆', 'St. Pauli': '圣保利', 'Holstein Kiel': '基尔',
    // 意甲
    'Inter Milan': '国际米兰', 'AC Milan': 'AC米兰', 'Napoli': '那不勒斯', 'Roma': '罗马',
    'Juventus': '尤文图斯', 'Bologna': '博洛尼亚', 'Venezia': '威尼斯', 'Genoa': '热那亚',
    'Atalanta': '亚特兰大', 'Lazio': '拉齐奥', 'Fiorentina': '佛罗伦萨', 'Torino': '都灵',
    'Udinese': '乌迪内斯', 'Cagliari': '卡利亚里', 'Lecce': '莱切', 'Parma': '帕尔马',
    'Monza': '蒙扎', 'Como': '科莫', 'Empoli': '恩波利', 'Verona': '维罗纳',
    // 法甲
    'PSG': '巴黎圣日耳曼', 'Strasbourg': '斯特拉斯堡', 'Brest': '布雷斯特', 'Lens': '朗斯',
    'Lille': '里尔', 'Troyes': '特鲁瓦', 'Marseille': '马赛', 'Lyon': '里昂', 'Monaco': '摩纳哥',
    'Nice': '尼斯', 'Rennes': '雷恩', 'Nantes': '南特', 'Toulouse': '图卢兹',
    'Reims': '兰斯', 'Montpellier': '蒙彼利埃', 'Auxerre': '欧塞尔', 'Le Havre': '勒阿弗尔',
    'Angers': '昂热', 'Saint-Etienne': '圣埃蒂安'
  };
  function teamCn(name) {
    var s = String(name == null ? '' : name).trim();
    if (!s) return '—';
    return TEAM_CN[s] || s;
  }

  /* ---------------- 归一化：fixture ---------------- */
  function normalizeFixture(f) {
    var rawStatus = pick(f, ['status.code', 'status.short', 'status', 'state'], 'scheduled');
    if (rawStatus && typeof rawStatus === 'object') rawStatus = rawStatus.short || rawStatus.code || 'scheduled';

    // 接口不下发比赛分钟数，进行中的比赛按开球时间推算（45 分钟处加 15 分钟中场）
    var kick = pick(f, ['kickoff_utc', 'date', 'fixture.date', 'kickoff'], null);
    var kickMs = kick ? new Date(kick).getTime() : (num(pick(f, ['kickoff_ts', 'timestamp'], 0)) * 1000 || Date.now());
    var bucket = statusBucket(rawStatus);
    var elapsed = num(pick(f, ['status.elapsed', 'elapsed', 'minute', 'status.minute'], 0), null);
    if (!elapsed && bucket === 'live' && kickMs) {
      var m = Math.floor((Date.now() - kickMs) / 60000);
      elapsed = m > 45 ? Math.min(90, m) : Math.max(1, m);
    }
    var st = mapStatus(rawStatus, elapsed || 0);

    var homeName = teamCn(pick(f, ['teams.home.name', 'home.name', 'homeTeam.name', 'home_team.name', 'homeName'], '主队'));
    var awayName = teamCn(pick(f, ['teams.away.name', 'away.name', 'awayTeam.name', 'away_team.name', 'awayName'], '客队'));
    var leagueId = pick(f, ['league.id', 'competition.id', 'league_id'], 0);

    function crest(name) {
      var s = String(name || '?');
      // 中文队名取前 2 字（如「多特蒙德」→「多特」），英文取前 3 字母（如「Everton」→「Eve」）
      var isCn = /[\u4e00-\u9fff]/.test(s);
      return { short: isCn ? s.slice(0, 2) : s.slice(0, 3), color: colorFrom(s) };
    }

    return {
      id: String(pick(f, ['id', 'fixture.id', 'fixture_id'], Math.random().toString(36).slice(2))),
      league: {
        id: leagueId,
        name: leagueName(leagueId, pick(f, ['league.name', 'competition.name', 'league_name'], '赛事'))
      },
      kickoff: new Date(kickMs),
      status: st.bucket,
      statusCode: String(rawStatus || '').toUpperCase(),
      minute: st.minute,
      statusLabel: st.label,
      home: Object.assign({ name: homeName, score: num(pick(f, ['goals.home', 'score.home', 'home.score', 'home_goals'], 0)) }, crest(homeName)),
      away: Object.assign({ name: awayName, score: num(pick(f, ['goals.away', 'score.away', 'away.score', 'away_goals'], 0)) }, crest(awayName)),
      corners: {
        h: num(pick(f, ['corners.home', 'stats.corners.home', 'home_corners'], 0)),
        a: num(pick(f, ['corners.away', 'stats.corners.away', 'away_corners'], 0))
      },
      cards: {
        yh: num(pick(f, ['cards.home.yellow', 'stats.cards.home.yellow', 'home_yellow'], 0)),
        ya: num(pick(f, ['cards.away.yellow', 'stats.cards.away.yellow', 'away_yellow'], 0)),
        rh: num(pick(f, ['cards.home.red', 'stats.cards.home.red', 'home_red'], 0)),
        ra: num(pick(f, ['cards.away.red', 'stats.cards.away.red', 'away_red'], 0))
      },
      odds: parseFixtureOdds(f),
      _raw: f
    };
  }
  function statusBucket(raw) {
    var c = String(raw || '').toLowerCase();
    if (c === 'live' || c === 'inplay' || c === '1h' || c === '2h' || c === 'ht') return 'live';
    if (c === 'finished' || c === 'ft' || c === 'aet' || c === 'pen') return 'finished';
    if (c === 'scheduled' || c === 'ns' || c === 'tbd' || c === 'upcoming') return 'upcoming';
    return 'other';
  }
  function num(v, dflt) { var n = parseFloat(v); return isNaN(n) ? (dflt === undefined ? 0 : dflt) : n; }
  function colorFrom(name) {
    var palette = ['#0b7a4b', '#2563eb', '#b42318', '#7c3aed', '#0f766e', '#b54708', '#334155', '#be123c'];
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  function parseFixtureOdds(f) {
    var out = { h: { open: 0, cur: 0 }, d: { open: 0, cur: 0 }, a: { open: 0, cur: 0 } };
    var markets = arr(pick(f, ['odds', 'markets', 'bookmaker.markets'], []));
    if (markets && !Array.isArray(markets) && typeof markets === 'object') {
      // 形如 {home:1.8, draw:3.4, away:4.2}
      if (markets.home !== undefined || markets['1'] !== undefined) {
        out.h.cur = num(markets.home || markets['1']);
        out.d.cur = num(markets.draw || markets['X']);
        out.a.cur = num(markets.away || markets['2']);
      }
      return out;
    }
    for (var i = 0; i < markets.length; i++) {
      var m = markets[i] || {};
      var mname = String(pick(m, ['name', 'key', 'label'], '')).toLowerCase();
      if (!/1x2|match winner|胜平负|full.?time result/.test(mname)) continue;
      var outs = arr(pick(m, ['odds', 'outcomes', 'values'], []));
      outs.forEach(function (o, idx) {
        var label = String(pick(o, ['label', 'name', 'outcome'], '')).toLowerCase();
        var cur = num(pick(o, ['price', 'odd', 'value', 'decimal', 'odds'], 0));
        var open = num(pick(o, ['opening', 'open', 'opening_price', 'initial'], cur));
        var slot = /home|1$/.test(label) ? 'h' : (/draw|x$/.test(label) ? 'd' : 'a');
        if (!/home|draw|away|1$|x$|2$/.test(label)) slot = ['h', 'd', 'a'][idx] || 'a';
        out[slot] = { open: open || cur, cur: cur || open };
      });
    }
    return out;
  }

  /* ---------------- 归一化：盘口 ---------------- */
  var MARKET_KEYS = [
    { key: '1x2', label: '1X2 胜平负', re: /1x2|match winner|胜平负/i },
    { key: 'ah', label: '亚洲让球盘', re: /asian|handicap|让球|亚盘/i },
    { key: 'ou', label: '大小球', re: /over.?under|totals?|进球数|大小球/i },
    { key: 'corner', label: '角球盘口', re: /corner|角球/i },
    { key: 'card', label: '红黄牌盘口', re: /card|booking|黄牌|红牌/i },
    { key: 'btts', label: '双方进球', re: /btts|both teams|双方进球/i }
  ];

  /* ---------------- 归一化：盘口 ----------------
     真实结构：data.bookmakers[].odds{ 市场key: {opening:{…}, closing:{…}, inplay:{…}} }
     市场 key 全部是下划线命名，与文档一致。 */
  var MARKET_META = {
    '1x2': { label: '1X2 胜平负', slots: [['home', '主胜'], ['draw', '平'], ['away', '客胜']] },
    'asian_handicap': { label: '亚洲让球盘', line: true, slots: [['home', '主'], ['away', '客']] },
    'goal_line': { label: '大小球', line: true, slots: [['over', '大'], ['under', '小']] },
    'goal_line_fixed': { label: '大小球（固定盘）', line: true, slots: [['over', '大'], ['under', '小']] },
    'corner_line': { label: '角球大小', line: true, slots: [['over', '大'], ['under', '小']] },
    'corner_asian': { label: '角球让球', line: true, slots: [['home', '主'], ['away', '客']] },
    'card_line': { label: '红黄牌大小', line: true, slots: [['over', '大'], ['under', '小']] },
    'card_asian': { label: '红黄牌让球', line: true, slots: [['home', '主'], ['away', '客']] },
    'btts': { label: '双方进球', slots: [['yes', '是'], ['no', '否']] },
    'asian_handicap_half': { label: '半场亚盘', line: true, slots: [['home', '主'], ['away', '客']] },
    'goal_line_half': { label: '半场大小球', line: true, slots: [['over', '大'], ['under', '小']] },
    'corner_line_half': { label: '半场角球大小', line: true, slots: [['over', '大'], ['under', '小']] }
  };
  var MARKET_ORDER = ['1x2', 'asian_handicap', 'goal_line', 'goal_line_fixed', 'corner_line',
    'corner_asian', 'card_line', 'card_asian', 'btts', 'asian_handicap_half', 'goal_line_half', 'corner_line_half'];

  function normalizeOddsGroups(json) {
    var data = payload(json) || {};
    var books = arr(pick(data, ['bookmakers'], []));
    if (!books.length && data && data.odds) books = [{ name: '', odds: data.odds }];
    if (!books.length) return [];

    var seen = {}, groups = [];
    books.forEach(function (b) {
      var odds = pick(b, ['odds'], {}) || {};
      Object.keys(odds).forEach(function (mk) {
        var m = odds[mk];
        if (!m || typeof m !== 'object') return;
        var meta = MARKET_META[mk];
        var openObj = pick(m, ['opening'], null) || {};
        var curObj = pick(m, ['inplay'], null) || pick(m, ['closing'], null) || openObj;
        var line = pick(curObj, ['line'], pick(openObj, ['line'], null));
        var lineTxt = (line === null || line === undefined) ? '' : ' ' + fmtLine(line);

        var slots = meta ? meta.slots : Object.keys(curObj)
          .filter(function (k) { return k !== 'line'; })
          .map(function (k) { return [k, k]; });

        var outcomes = [];
        slots.forEach(function (s) {
          var cur = num(pick(curObj, [s[0]], 0));
          if (!(cur > 1)) return;
          var open = num(pick(openObj, [s[0]], cur)) || cur;
          outcomes.push({ label: s[1] + lineTxt, open: open, cur: cur });
        });
        if (!outcomes.length) return;

        var label = (meta ? meta.label : mk) + (mk === '1x2' ? '' : '');
        var key = meta ? mk : 'other';
        if (seen[key]) {
          // 多家博彩商同名盘口：保留第一家，避免选项重复堆叠
          return;
        }
        seen[key] = true;
        groups.push({ key: key, label: label, bookmaker: pick(b, ['name'], ''), outcomes: outcomes });
      });
    });

    groups.sort(function (a, b) {
      var ia = MARKET_ORDER.indexOf(a.key), ib = MARKET_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return groups;
  }
  function fmtLine(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return String(v);
    return (n > 0 ? '+' : '') + (Math.round(n * 100) / 100);
  }

  function normalizeHistory(json) {
    var data = payload(json);
    var rows = arr(pick(data, ['history', 'prices', 'ticks'], null)) || (Array.isArray(data) ? data : []);
    if (!rows.length && data && typeof data === 'object') {
      var inner = arr(pick(data, ['data', 'items'], []));
      rows = inner;
    }
    var groups = {};
    rows.forEach(function (r) {
      var t = new Date(pick(r, ['time', 'timestamp', 'created_at', 'date'], Date.now())).getTime();
      var label = String(pick(r, ['label', 'selection', 'outcome', 'name'], ''));
      var price = num(pick(r, ['price', 'odd', 'value', 'decimal'], 0));
      if (!label || !price) return;
      (groups[label] = groups[label] || []).push({ t: t, v: price });
    });
    var palette = ['#0b7a4b', '#2563eb', '#e11d48', '#a855f7', '#f59e0b'];
    var series = Object.keys(groups).map(function (label, i) {
      var pts = groups[label].sort(function (a, b) { return a.t - b.t; });
      return {
        label: label, color: palette[i % palette.length],
        points: pts.map(function (p, idx) { return { i: idx, v: p.v, t: p.t }; })
      };
    });
    return { series: series };
  }

  /* ---------------- 对外方法 ---------------- */
  /* 联赛 ID 来自 /leagues 实测值（不是 API-Football 的那套 id） */
  var TOP5 = [
    { id: 4160026622, name: '英超', country: '英格兰', en: 'England Premier League' },
    { id: 4212821298, name: '西甲', country: '西班牙', en: 'Spain La Liga' },
    { id: 686337048, name: '德甲', country: '德国', en: 'Germany Bundesliga I' },
    { id: 3405541143, name: '意甲', country: '意大利', en: 'Italy Serie A' },
    { id: 3614399544, name: '法甲', country: '法国', en: 'France Ligue 1' }
  ];

  FD.api = {
    leagues: TOP5,
    markets: FD.mock.markets,
    config: config,
    saveConfig: saveConfig,
    hasKey: function () { return !!config.key; },
    isProxy: function () { return !!proxyBase(); },
    proxyBase: function () { return proxyBase(); },
    remainingQuota: remainingQuota,
    usedQuota: usedQuota,
    limit: HOURLY_LIMIT,
    request: request,
    normalizeFixture: normalizeFixture,
    normalizeOddsGroups: normalizeOddsGroups,
    normalizeHistory: normalizeHistory,

    fixtures: function (opts) {
      opts = opts || {};
      // 接口的时间筛选是 start_time / end_time（unix 秒，窗口最大 24 小时）
      var now = Math.floor(Date.now() / 1000);
      var params = {
        start_time: opts.startTime || (now - 6 * 3600),
        end_time: opts.endTime || (now + 18 * 3600),
        per_page: 100
      };
      if (opts.leagueId) params.league = opts.leagueId;
      if (opts.status) {
        var map = { live: 'live', upcoming: 'scheduled', scheduled: 'scheduled', finished: 'finished' };
        params.status = map[opts.status] || opts.status;
      }
      return request('/fixtures', params).then(function (json) {
        var list = arr(payload(json)).map(normalizeFixture);
        // 按开球时间排序，进行中优先
        var rank = { live: 0, upcoming: 1, finished: 2 };
        list.sort(function (a, b) {
          var ra = rank[a.status] === undefined ? 3 : rank[a.status];
          var rb = rank[b.status] === undefined ? 3 : rank[b.status];
          if (ra !== rb) return ra - rb;
          return a.kickoff - b.kickoff;
        });
        return list;
      });
    },

    fixture: function (id) {
      return request('/fixtures/' + id).then(function (json) {
        var d = payload(json);
        return normalizeFixture(Array.isArray(d) ? d[0] : d);
      });
    },

    statistics: function (id) {
      return request('/fixtures/' + id + '/statistics').then(function (json) {
        return payload(json);
      });
    },

    odds: function (id, market) {
      return request('/fixtures/' + id + '/odds', market ? { market: market } : null)
        .then(normalizeOddsGroups);
    },

    oddsHistory: function (id, market) {
      return request('/fixtures/' + id + '/odds/history', { market: market || '1x2', per_page: 500 })
        .then(normalizeHistory);
    },

    events: function (id) {
      return request('/fixtures/' + id + '/events').then(function (json) {
        // 真实结构：{ data: { fixture_id, events: [...] } }
        var list = arr(pick(payload(json), ['events'], null)) || arr(payload(json));
        return list.map(function (e) {
          var t = String(pick(e, ['type'], 'info')).toLowerCase();
          var map = {
            goal: 'goal', own_goal: 'goal', penalty: 'goal',
            yellow_card: 'yellow', red_card: 'red', second_yellow: 'red', yellow_red_card: 'red',
            corner: 'corner', substitution: 'sub'
          };
          var side = String(pick(e, ['team', 'team.side', 'side'], '')).toLowerCase();
          var cnt = num(pick(e, ['count'], 0));
          var period = pick(e, ['period'], null);
          var sc = pick(e, ['score'], null);
          var text;
          if (t === 'period_score') {
            text = (period === 'first_half' ? '半场比分' : '阶段比分') + (sc ? ' ' + sc.home + '-' + sc.away : '');
          } else if (t === 'corner') {
            text = '角球（本场第 ' + cnt + ' 个）';
          } else if (t === 'yellow_card') {
            text = '黄牌（本队第 ' + cnt + ' 张）';
          } else if (t === 'red_card' || t === 'yellow_red_card' || t === 'second_yellow') {
            text = '红牌';
          } else if (t === 'goal' || t === 'own_goal' || t === 'penalty') {
            text = t === 'own_goal' ? '乌龙球' : (t === 'penalty' ? '点球' : '进球');
          } else {
            text = t;
          }
          return {
            minute: num(pick(e, ['minute', 'elapsed'], 0)),
            type: map[t] || 'info',
            side: side === 'away' ? 'away' : 'home',
            text: text,
            note: t
          };
        }).filter(function (e) { return e.minute > 0 || e.type === 'info'; });
      });
    },

    standings: function (leagueId, type) {
      var params = { league: leagueId };
      if (type && type !== 'points') params.type = type;
      return request('/standings', params).then(function (json) {
        // 真实结构：{ data: { league_id, season, type, round, table: [...] } }
        var rows = arr(pick(payload(json), ['table'], null)) || arr(payload(json));
        return rows.map(function (r, i) {
          var name = teamCn(pick(r, ['team.name', 'team', 'name'], '—'));
          var isCn = /[\u4e00-\u9fff]/.test(name);
          return {
            pos: num(pick(r, ['position', 'rank', 'pos'], i + 1)),
            team: name,
            short: isCn ? String(name).slice(0, 2) : String(name).slice(0, 3),
            color: colorFrom(String(name)),
            played: num(pick(r, ['played', 'games', 'all.played'], 0)),
            win: num(pick(r, ['win', 'won', 'all.win'], 0)),
            draw: num(pick(r, ['draw', 'drawn', 'all.draw'], 0)),
            loss: num(pick(r, ['lose', 'lost', 'all.lose'], 0)),
            gf: num(pick(r, ['goals_for', 'all.goals.for'], 0)),
            ga: num(pick(r, ['goals_against', 'all.goals.against'], 0)),
            gd: num(pick(r, ['goal_difference', 'goalsDiff', 'gd'], 0)),
            pts: num(pick(r, ['points', 'pts'], 0)),
            for: num(pick(r, ['total_for', 'for'], 0)),
            against: num(pick(r, ['total_against', 'against'], 0)),
            total: num(pick(r, ['total_for', 'total'], 0)) + num(pick(r, ['total_against'], 0)),
            avg: num(pick(r, ['average_for', 'average', 'avg'], 0)),
            yellow: num(pick(r, ['yellow.total', 'yellow', 'cards.yellow'], 0)),
            red: num(pick(r, ['red.total', 'red', 'cards.red'], 0))
          };
        });
      });
    }
  };
})(window);
