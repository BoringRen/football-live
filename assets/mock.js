/* =========================================================
   mock.js —— 内置演示数据（无需 API Key 即可预览全部功能）
   数据模型与 api.js 归一化后的结构完全一致，
   因此 ui.js 不需要为「演示 / 真实」写两套渲染逻辑。
   ========================================================= */
(function (global) {
  'use strict';

  var FD = global.FD = global.FD || {};

  /* ---------- 联赛与球队 ----------
     id 与真实 API 的 /leagues 保持一致，否则演示模式的联赛筛选会失效。 */
  var LEAGUES = [
    { id: 4160026622, name: '英超', country: '英格兰' },
    { id: 4212821298, name: '西甲', country: '西班牙' },
    { id: 686337048,  name: '德甲', country: '德国' },
    { id: 3405541143, name: '意甲', country: '意大利' },
    { id: 3614399544, name: '法甲', country: '法国' }
  ];

  /* 球队库仍按旧的短 id 存放，这里做一层别名映射 */
  var LEAGUE_ALIAS = {
    4160026622: 39, 4212821298: 140, 686337048: 78, 3405541143: 135, 3614399544: 61
  };
  function teamsOf(id) { return TEAMS[LEAGUE_ALIAS[id] || id] || TEAMS[39]; }

  var TEAMS = {
    39: [
      ['曼城', 'MCI', '#6cabdd'], ['阿森纳', 'ARS', '#ef0107'], ['利物浦', 'LIV', '#c8102e'],
      ['切尔西', 'CHE', '#034694'], ['曼联', 'MUN', '#da291c'], ['热刺', 'TOT', '#132257'],
      ['纽卡斯尔', 'NEW', '#241f20'], ['维拉', 'AVL', '#95bfe5'], ['布莱顿', 'BHA', '#0057b8'],
      ['西汉姆', 'WHU', '#7a263a']
    ],
    140: [
      ['皇马', 'RMA', '#febe10'], ['巴萨', 'BAR', '#a50044'], ['马竞', 'ATM', '#cb3524'],
      ['毕尔巴鄂', 'ATH', '#ee2523'], ['皇家社会', 'RSO', '#0067b1'], ['比利亚雷亚尔', 'VIL', '#ffe667'],
      ['贝蒂斯', 'BET', '#00954c'], ['塞维利亚', 'SEV', '#d81f2a'], ['瓦伦西亚', 'VAL', '#f8a800'],
      ['赫罗纳', 'GIR', '#cd2534']
    ],
    78: [
      ['拜仁', 'FCB', '#dc052d'], ['多特蒙德', 'BVB', '#fde100'], ['勒沃库森', 'B04', '#e32221'],
      ['莱比锡', 'RBL', '#dd0741'], ['法兰克福', 'SGE', '#e1000f'], ['斯图加特', 'VFB', '#e32219'],
      ['不莱梅', 'SVW', '#1d9053'], ['弗赖堡', 'SCF', '#000000'], ['沃尔夫斯堡', 'WOB', '#65b32e'],
      ['门兴', 'BMG', '#000000']
    ],
    135: [
      ['国际米兰', 'INT', '#0068a8'], ['AC米兰', 'MIL', '#fb090b'], ['尤文图斯', 'JUV', '#000000'],
      ['那不勒斯', 'NAP', '#12a0d7'], ['罗马', 'ROM', '#8e1f2f'], ['拉齐奥', 'LAZ', '#87d8f7'],
      ['亚特兰大', 'ATA', '#1e71b8'], ['佛罗伦萨', 'FIO', '#592c82'], ['博洛尼亚', 'BOL', '#1a2f48'],
      ['都灵', 'TOR', '#8b1e2d']
    ],
    61: [
      ['巴黎圣曼', 'PSG', '#004170'], ['摩纳哥', 'MON', '#e51b22'], ['马赛', 'OM', '#2faee0'],
      ['里尔', 'LIL', '#e01e2b'], ['里昂', 'OL', '#14387f'], ['尼斯', 'NIC', '#c8102e'],
      ['朗斯', 'RCL', '#ffe500'], ['雷恩', 'REN', '#e13327'], ['图卢兹', 'TFC', '#582c83'],
      ['南特', 'FCN', '#fdcb00']
    ]
  };

  /* ---------- 稳定随机数（同一 fixture 每次渲染一致） ---------- */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rng(seed) {
    var a = typeof seed === 'string' ? hash(seed) : seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function ri(r, min, max) { return min + Math.floor(r() * (max - min + 1)); }
  function rf(r, min, max) { return min + r() * (max - min); }

  function teamOf(leagueId, idx) {
    var tl = teamsOf(leagueId);
    var t = tl[idx % tl.length];
    return { name: t[0], short: t[1], color: t[2] };
  }

  /* ---------- 生成初始赛程 ---------- */
  var fixtures = [];
  var done = [];

  function makeFixture(leagueId, homeIdx, awayIdx, mode, seedKey) {
    var r = rng(seedKey);
    var lg = LEAGUES.filter(function (l) { return l.id === leagueId; })[0];
    var home = teamOf(leagueId, homeIdx);
    var away = teamOf(leagueId, awayIdx);
    var now = Date.now();

    var minute = 0, status = 'upcoming', statusCode = 'NS', kickoff = now + 3600e3;
    if (mode === 'live') {
      minute = ri(r, 5, 88);
      status = 'live';
      statusCode = minute <= 45 ? '1H' : '2H';
      kickoff = now - minute * 60e3;
    } else if (mode === 'finished') {
      minute = 90;
      status = 'finished';
      statusCode = 'FT';
      kickoff = now - ri(r, 3, 30) * 3600e3;
    } else {
      kickoff = now + ri(r, 1, 40) * 60e3 * 13;
    }

    var played = status !== 'upcoming';
    var gh = played ? (r() < 0.75 ? ri(r, 0, 3) : 0) : 0;
    var ga = played ? (r() < 0.7 ? ri(r, 0, 3) : 0) : 0;

    var f = {
      id: seedKey,
      league: { id: lg.id, name: lg.name },
      kickoff: kickoff,
      status: status,
      statusCode: statusCode,
      minute: minute,
      home: { name: home.name, short: home.short, color: home.color, score: gh },
      away: { name: away.name, short: away.short, color: away.color, score: ga },
      corners: { h: played ? ri(r, 0, 9) : 0, a: played ? ri(r, 0, 9) : 0 },
      cards: {
        yh: played ? ri(r, 0, 4) : 0, ya: played ? ri(r, 0, 4) : 0,
        rh: played && r() < 0.08 ? 1 : 0, ra: played && r() < 0.08 ? 1 : 0
      },
      odds: {
        h: { open: +(rf(r, 1.5, 4.2)).toFixed(2), cur: 0 },
        d: { open: +(rf(r, 3.0, 4.4)).toFixed(2), cur: 0 },
        a: { open: +(rf(r, 1.7, 6.2)).toFixed(2), cur: 0 }
      },
      _r: r,
      _seed: seedKey
    };
    ['h', 'd', 'a'].forEach(function (k) {
      var drift = rf(r, -0.18, 0.18);
      f.odds[k].cur = +(Math.max(1.02, f.odds[k].open + drift)).toFixed(2);
    });
    return f;
  }

  function seedFixtures() {
    fixtures = [];
    var idx = 0;
    LEAGUES.forEach(function (lg, li) {
      var modes = ['live', 'live', 'upcoming', 'finished', 'live', 'upcoming'];
      modes.forEach(function (mode, mi) {
        var hi = (mi * 2 + li) % 10, ai = (mi * 2 + li + 5) % 10;
        if (hi === ai) ai = (ai + 1) % 10;
        fixtures.push(makeFixture(lg.id, hi, ai, mode, 'm' + lg.id + '-' + mi + '-' + (idx++)));
      });
    });
  }
  seedFixtures();

  /* ---------- 统计（按 fixture 稳定生成） ---------- */
  function statistics(f) {
    var r = rng('stat-' + f._seed);
    var homeAdv = 4;
    var poss = ri(r, 38, 62);
    var shotsH = ri(r, 6, 19), shotsA = ri(r, 4, 17);
    var onH = Math.max(1, Math.round(shotsH * rf(r, 0.28, 0.55)));
    var onA = Math.max(1, Math.round(shotsA * rf(r, 0.26, 0.52)));
    return {
      possession: { h: poss, a: 100 - poss },
      shots: { h: shotsH, a: shotsA },
      shotsOnTarget: { h: onH, a: onA },
      corners: { h: f.corners.h, a: f.corners.a },
      yellow: { h: f.cards.yh, a: f.cards.ya },
      red: { h: f.cards.rh, a: f.cards.ra },
      attacks: { h: ri(r, 68, 138) + homeAdv, a: ri(r, 60, 128) },
      dangerous: { h: ri(r, 32, 74), a: ri(r, 26, 68) },
      saves: { h: ri(r, 0, 6), a: ri(r, 0, 6) },
      fouls: { h: ri(r, 6, 17), a: ri(r, 6, 17) },
      offsides: { h: ri(r, 0, 4), a: ri(r, 0, 4) }
    };
  }

  /* ---------- 盘口 ---------- */
  var MARKETS = [
    { key: '1x2', label: '1X2 胜平负' },
    { key: 'ah', label: '亚洲让球盘' },
    { key: 'ou', label: '大小球' },
    { key: 'corner', label: '角球盘口' },
    { key: 'card', label: '红黄牌盘口' },
    { key: 'btts', label: '双方进球' }
  ];

  function marketOutcomes(f, market) {
    var r = rng('mk-' + f._seed + '-' + market);
    var o = [];
    if (market === '1x2') {
      o = [
        { label: '主胜', open: f.odds.h.open, cur: f.odds.h.cur },
        { label: '平局', open: f.odds.d.open, cur: f.odds.d.cur },
        { label: '客胜', open: f.odds.a.open, cur: f.odds.a.cur }
      ];
    } else if (market === 'ah') {
      var line = pick(r, ['-0.25', '-0.5', '-0.75', '+0.25', '0']);
      o = [
        { label: '主 ' + line, open: +rf(r, 1.7, 2.15).toFixed(2), cur: 0 },
        { label: '客 ' + (line[0] === '-' ? '+' + line.slice(1) : '-' + line.slice(1)), open: +rf(r, 1.7, 2.15).toFixed(2), cur: 0 }
      ];
    } else if (market === 'ou') {
      var gl = pick(r, ['2.5', '2.75', '3.0', '3.25']);
      o = [
        { label: '大 ' + gl, open: +rf(r, 1.72, 2.1).toFixed(2), cur: 0 },
        { label: '小 ' + gl, open: +rf(r, 1.72, 2.1).toFixed(2), cur: 0 }
      ];
    } else if (market === 'corner') {
      var cl = pick(r, ['8.5', '9.5', '10.5']);
      o = [
        { label: '角球 大 ' + cl, open: +rf(r, 1.75, 2.05).toFixed(2), cur: 0 },
        { label: '角球 小 ' + cl, open: +rf(r, 1.75, 2.05).toFixed(2), cur: 0 },
        { label: '主队角球 大 4.5', open: +rf(r, 1.8, 2.2).toFixed(2), cur: 0 },
        { label: '客队角球 大 4.5', open: +rf(r, 1.8, 2.2).toFixed(2), cur: 0 }
      ];
    } else if (market === 'card') {
      var kl = pick(r, ['3.5', '4.5', '5.5']);
      o = [
        { label: '黄牌 大 ' + kl, open: +rf(r, 1.72, 2.08).toFixed(2), cur: 0 },
        { label: '黄牌 小 ' + kl, open: +rf(r, 1.72, 2.08).toFixed(2), cur: 0 },
        { label: '出现红牌', open: +rf(r, 3.2, 6.5).toFixed(2), cur: 0 }
      ];
    } else {
      o = [
        { label: '是', open: +rf(r, 1.65, 2.0).toFixed(2), cur: 0 },
        { label: '否', open: +rf(r, 1.75, 2.3).toFixed(2), cur: 0 }
      ];
    }
    o.forEach(function (item) {
      if (!item.cur) {
        item.cur = +(Math.max(1.02, item.open + rf(r, -0.16, 0.16))).toFixed(2);
      }
    });
    return o;
  }

  /* ---------- 赔率变动历史 ---------- */
  function oddsHistory(f, market) {
    var outs = marketOutcomes(f, market);
    var r = rng('hist-' + f._seed + '-' + market);
    var pts = market === '1x2' ? 26 : 18;
    var series = outs.map(function (o) {
      return { label: o.label, color: null, points: [] };
    });
    var palette = ['#0b7a4b', '#2563eb', '#e11d48', '#a855f7', '#f59e0b'];
    series.forEach(function (s, i) { s.color = palette[i % palette.length]; });

    for (var t = 0; t < pts; t++) {
      var ratio = t / (pts - 1);
      outs.forEach(function (o, i) {
        var base = o.open + (o.cur - o.open) * ratio;
        var noise = (r() - 0.5) * 0.05;
        series[i].points.push({
          i: t,
          v: +Math.max(1.02, base + noise).toFixed(3)
        });
      });
    }
    return { market: market, series: series };
  }

  /* ---------- 事件时间线 ---------- */
  function events(f) {
    if (f.status === 'upcoming') return [];
    var r = rng('ev-' + f._seed);
    var list = [];
    var maxMin = f.status === 'finished' ? 90 : Math.max(1, f.minute);
    var rh = f.home.name, ra = f.away.name;

    var goalTimes = [];
    for (var i = 0; i < f.home.score; i++) goalTimes.push({ m: ri(r, 3, maxMin), side: 'home' });
    for (var j = 0; j < f.away.score; j++) goalTimes.push({ m: ri(r, 3, maxMin), side: 'away' });

    goalTimes.forEach(function (g) {
      list.push({ minute: g.m, type: 'goal', side: g.side, text: g.side === 'home' ? rh : ra, note: '进球' });
    });
    for (var k = 0; k < f.cards.yh; k++) list.push({ minute: ri(r, 8, maxMin), type: 'yellow', side: 'home', text: rh, note: '黄牌' });
    for (var k2 = 0; k2 < f.cards.ya; k2++) list.push({ minute: ri(r, 8, maxMin), type: 'yellow', side: 'away', text: ra, note: '黄牌' });
    if (f.cards.rh) list.push({ minute: ri(r, 20, maxMin), type: 'red', side: 'home', text: rh, note: '红牌' });
    if (f.cards.ra) list.push({ minute: ri(r, 20, maxMin), type: 'red', side: 'away', text: ra, note: '红牌' });

    list.sort(function (a, b) { return a.minute - b.minute; });
    return list;
  }

  /* ---------- 积分榜 ---------- */
  function standings(leagueId, type) {
    var r = rng('st-' + leagueId + '-' + type);
    var teams = teamsOf(leagueId);
    var rows = teams.map(function (t, i) {
      var p = ri(r, 24, 30);
      var w = ri(r, 10, 21);
      var d = ri(r, 2, Math.max(3, p - w));
      var l = p - w - d;
      return {
        pos: 0, team: t[0], short: t[1], color: t[2],
        played: p, win: w, draw: d, loss: l,
        gf: ri(r, 30, 70), ga: ri(r, 20, 55),
        pts: w * 3 + d
      };
    });
    rows.sort(function (a, b) { return b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga); });

    if (type === 'corner') {
      rows = rows.map(function (row, i) {
        var cf = ri(r, 120, 210), ca = ri(r, 100, 200);
        return {
          pos: i + 1, team: row.team, short: row.short, color: row.color,
          played: row.played, for: cf, against: ca,
          total: cf + ca, avg: +(cf / row.played).toFixed(2)
        };
      });
      rows.sort(function (a, b) { return b.avg - a.avg; });
      rows.forEach(function (x, i) { x.pos = i + 1; });
      return rows;
    }
    if (type === 'card') {
      rows = rows.map(function (row, i) {
        var y = ri(r, 45, 88), rd = ri(r, 0, 5);
        return {
          pos: i + 1, team: row.team, short: row.short, color: row.color,
          played: row.played, yellow: y, red: rd, total: y + rd * 2,
          avg: +((y + rd * 2) / row.played).toFixed(2)
        };
      });
      rows.sort(function (a, b) { return b.avg - a.avg; });
      rows.forEach(function (x, i) { x.pos = i + 1; });
      return rows;
    }
    rows.forEach(function (row, i) { row.pos = i + 1; row.gd = row.gf - row.ga; });
    return rows;
  }

  /* ---------- 实时推进（模拟数据每 tick 演化） ---------- */
  function tick() {
    fixtures.forEach(function (f) {
      if (f.status !== 'live') return;
      var r = rng('tick-' + f._seed + '-' + Math.floor(Date.now() / 1000));
      f.minute += ri(r, 1, 2);
      if (f.minute >= 45 && f.minute <= 47) { f.statusCode = 'HT'; }
      if (f.minute > 47) { f.statusCode = '2H'; }
      if (f.minute >= 90) {
        f.minute = 90; f.status = 'finished'; f.statusCode = 'FT';
        return;
      }
      if (r() < 0.035) { f.home.score++; }
      if (r() < 0.030) { f.away.score++; }
      if (r() < 0.16) { f.corners.h++; } else if (r() < 0.30) { f.corners.a++; }
      if (r() < 0.05) { f.cards.yh++; }
      if (r() < 0.05) { f.cards.ya++; }
      ['h', 'd', 'a'].forEach(function (k) {
        var drift = (r() - 0.5) * 0.05;
        f.odds[k].cur = +Math.max(1.02, f.odds[k].cur + drift).toFixed(2);
      });
    });
  }

  FD.mock = {
    leagues: LEAGUES,
    markets: MARKETS,
    fixtures: function () { return fixtures.slice(); },
    tick: tick,
    statistics: statistics,
    marketOutcomes: marketOutcomes,
    oddsHistory: oddsHistory,
    events: events,
    standings: standings,
    reset: seedFixtures
  };
})(window);
