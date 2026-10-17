/* =========================================================
   ui.js —— 渲染与交互
   ========================================================= */
(function (global) {
  'use strict';

  var FD = global.FD;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- 状态 ---------------- */
  var state = {
    view: 'matches',
    leagueId: 'all',
    statusFilter: 'all',
    fixtures: [],
    selected: null,
    drawerTab: 'stats',
    drawerMarket: '1x2',
    standingsLeague: (FD.api.leagues[0] || {}).id,
    standingsType: 'points',
    standings: [],
    loading: false,
    error: null,
    nextTick: 0,
    retryAt: null,
    lastUpdated: null
  };

  var cache = { stats: {}, odds: {}, history: {}, events: {} };
  var timers = { clock: null, countdown: null, poll: null, mockTick: null };

  function source() { return (FD.api.hasKey() || FD.api.isProxy()) ? 'api' : 'mock'; }
  function isApi() { return source() === 'api'; }

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function hhmm(d) {
    var x = new Date(d);
    return pad(x.getHours()) + ':' + pad(x.getMinutes());
  }
  function mmdd(d) {
    var x = new Date(d);
    return (x.getMonth() + 1) + '/' + x.getDate();
  }
  function fmtNum(n, d) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    return Number(n).toFixed(d === undefined ? 2 : d);
  }
  function moveClass(delta) {
    if (delta > 0.001) return 'up';
    if (delta < -0.001) return 'down';
    return 'flat';
  }
  function moveArrow(delta) {
    if (delta > 0.001) return '&#9650;';
    if (delta < -0.001) return '&#9660;';
    return '&#8211;';
  }
  function statusPillText(f) {
    if (f.status === 'live') {
      if (f.statusCode === 'HT') return 'HT';
      return (f.minute || 0) + "'";
    }
    if (f.status === 'finished') return '已结束';
    if (f.status === 'upcoming') return '未开始';
    return f.statusLabel || '—';
  }

  /* ---------------- 数据获取（统一 mock / api） ---------------- */
  function ensureFixtures() {
    if (!isApi()) {
      state.fixtures = FD.mock.fixtures();
      return Promise.resolve(state.fixtures);
    }
    return FD.api.fixtures({ per_page: 100 }).then(function (list) {
      state.fixtures = list;
      return list;
    });
  }

  function ensureStats(f) {
    var k = f.id;
    if (cache.stats[k]) return Promise.resolve(cache.stats[k]);
    var p = isApi()
      ? FD.api.statistics(f.id).then(function (raw) {
          var rows = statRows(raw);
          // 未开赛时接口会返回全 0，这种空壳不值得展示
          var real = rows.some(function (r) { return (r.h || 0) + (r.a || 0) > 0; });
          return real ? rows : [];
        })
      : Promise.resolve(mockStatRows(f));
    return p.then(function (rows) { cache.stats[k] = rows; return rows; });
  }

  function mockStatRows(f) {
    var s = FD.mock.statistics(f);
    return [
      { label: '控球率', h: s.possession.h, a: s.possession.a, unit: '%', pct: true },
      { label: '射门', h: s.shots.h, a: s.shots.a },
      { label: '射正', h: s.shotsOnTarget.h, a: s.shotsOnTarget.a },
      { label: '角球', h: s.corners.h, a: s.corners.a },
      { label: '危险进攻', h: s.dangerous.h, a: s.dangerous.a },
      { label: '进攻', h: s.attacks.h, a: s.attacks.a },
      { label: '犯规', h: s.fouls.h, a: s.fouls.a },
      { label: '黄牌', h: s.yellow.h, a: s.yellow.a },
      { label: '红牌', h: s.red.h, a: s.red.a },
      { label: '越位', h: s.offsides.h, a: s.offsides.a },
      { label: '扑救', h: s.saves.h, a: s.saves.a }
    ];
  }

  /* API 统计结构容错：数组形式或对象形式都尝试映射 */
  function statRows(raw) {
    var out = [];
    var labelMap = {
      'ball possession': '控球率', 'possession': '控球率',
      'total shots': '射门', 'shots': '射门', 'shots total': '射门',
      'shots on goal': '射正', 'shots on target': '射正', 'on target': '射正',
      'shots_on_target': '射正', 'shots_off_target': '射偏',
      'corner kicks': '角球', 'corners': '角球',
      'dangerous attacks': '危险进攻', 'dangerous_attacks': '危险进攻',
      'attacks': '进攻', 'total attacks': '进攻', 'total_attacks': '进攻',
      'fouls': '犯规', 'yellow cards': '黄牌', 'red cards': '红牌',
      'offsides': '越位', 'goalkeeper saves': '扑救', 'saves': '扑救'
    };
    function cn(name) {
      var k = String(name || '').toLowerCase().trim();
      return labelMap[k] || name;
    }
    var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : null);
    if (list && list.length && (list[0].type || list[0].name)) {
      list.forEach(function (it) {
        var h = parseFloat(it.home !== undefined ? it.home : it.h);
        var a = parseFloat(it.away !== undefined ? it.away : it.a);
        if (isNaN(h) && isNaN(a)) return;
        var unit = /%/.test(String(it.home)) || /possession/i.test(String(it.type || it.name)) ? '%' : '';
        out.push({
          label: cn(it.type || it.name), h: isNaN(h) ? 0 : h, a: isNaN(a) ? 0 : a,
          unit: unit, pct: unit === '%'
        });
      });
      return out;
    }
    var obj = raw && (raw.statistics || raw.stats || raw);
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(function (key) {
        var v = obj[key];
        if (v && typeof v === 'object' && v.home !== undefined) {
          out.push({
            label: cn(key), h: parseFloat(v.home) || 0, a: parseFloat(v.away) || 0,
            unit: /%/.test(String(v.home)) ? '%' : '', pct: /possession/i.test(key)
          });
        }
      });
    }
    return out;
  }

  function ensureOdds(f) {
    var k = f.id;
    if (cache.odds[k]) return Promise.resolve(cache.odds[k]);
    var p = isApi()
      ? FD.api.odds(f.id)                                  // 真实模式不掺假数据
      : Promise.resolve(mockOddsGroups(f));
    return p.then(function (g) { cache.odds[k] = g; return g; });
  }

  function mockOddsGroups(f) {
    return FD.mock.markets.map(function (m) {
      return { key: m.key, label: m.label, outcomes: FD.mock.marketOutcomes(f, m.key) };
    });
  }

  function ensureHistory(f, market) {
    var k = f.id + ':' + market;
    if (cache.history[k]) return Promise.resolve(cache.history[k]);
    var p = isApi()
      ? FD.api.oddsHistory(f.id, market)                   // 免费层会 403，交给上层提示
      : Promise.resolve(FD.mock.oddsHistory(f, market));
    return p.then(function (h) { cache.history[k] = h; return h; });
  }

  function ensureEvents(f) {
    var k = f.id;
    if (cache.events[k]) return Promise.resolve(cache.events[k]);
    var p = isApi()
      ? FD.api.events(f.id)
      : Promise.resolve(FD.mock.events(f));
    return p.then(function (l) { cache.events[k] = l; return l; });
  }

  /* ---------------- 顶部状态 ---------------- */
  function renderTopbar() {
    var badge = $('#sourceBadge');
    if (isApi()) {
      badge.className = 'badge is-live';
      badge.textContent = FD.api.isProxy() ? '实时 API · 代理' : 'API 已连接';
    } else {
      badge.className = 'badge';
      badge.textContent = '演示数据';
    }
    renderQuota();
  }

  function renderQuota() {
    var left = isApi() ? FD.api.remainingQuota() : FD.api.limit;
    var used = isApi() ? FD.api.usedQuota() : 0;
    var pct = Math.max(0, Math.min(100, left / FD.api.limit * 100));
    var fill = $('#quotaFill');
    fill.style.width = pct + '%';
    fill.style.background = left <= 6 ? 'var(--live)' : (left <= 18 ? '#f59e0b' : 'var(--accent)');
    $('#quotaText').textContent = isApi()
      ? '配额 ' + left + '/' + FD.api.limit + '（已用 ' + used + '）'
      : '配额 ' + FD.api.limit + '/' + FD.api.limit + '（演示）';
  }

  /* ---------------- 赛事列表 ---------------- */
  function renderLeagueChips() {
    var leagues = FD.api.leagues;
    var html = '<button class="chip" data-league="all">全部联赛</button>';
    leagues.forEach(function (l) {
      html += '<button class="chip" data-league="' + l.id + '">' + esc(l.name) + '</button>';
    });
    var box = $('#leagueChips');
    box.innerHTML = html;
    $$('.chip', box).forEach(function (b) {
      b.classList.toggle('is-active', String(state.leagueId) === b.dataset.league);
      b.addEventListener('click', function () {
        state.leagueId = b.dataset.league === 'all' ? 'all' : parseInt(b.dataset.league, 10);
        renderLeagueChips();
        renderMatches();
      });
    });
  }

  function filtered() {
    return state.fixtures.filter(function (f) {
      if (state.leagueId !== 'all' && Number(f.league.id) !== Number(state.leagueId)) return false;
      if (state.statusFilter !== 'all' && f.status !== state.statusFilter) return false;
      return true;
    }).sort(function (a, b) {
      var w = { live: 0, upcoming: 1, finished: 2, other: 3 };
      if (w[a.status] !== w[b.status]) return w[a.status] - w[b.status];
      if (a.status === 'live') return b.minute - a.minute;
      if (a.status === 'upcoming') return new Date(a.kickoff) - new Date(b.kickoff);
      return new Date(b.kickoff) - new Date(a.kickoff);
    });
  }

  function renderMatches() {
    var wrap = $('#matchGrid');
    $$('.banner.err').forEach(function (b) { b.remove(); });
    if (state.loading && !state.fixtures.length) {
      wrap.innerHTML = Array.apply(null, Array(6)).map(function () {
        return '<div class="skeleton"></div>';
      }).join('');
      return;
    }
    if (state.error) {
      wrap.innerHTML = '';
      var banner = document.createElement('div');
      banner.className = 'banner err';
      banner.style.gridColumn = '1 / -1';
      banner.innerHTML = '<div><b>' + esc(state.error.message) + '</b><br>' + esc(state.error.hint || '') + '</div>';
      wrap.parentNode.insertBefore(banner, wrap);
      return;
    }
    var list = filtered();
    if (!list.length) {
      wrap.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>没有符合条件的比赛</b>换个联赛或状态筛选试试</div>';
      return;
    }
    wrap.innerHTML = list.map(cardHtml).join('');
    $$('.match-card', wrap).forEach(function (card) {
      card.addEventListener('click', function () {
        var f = state.fixtures.filter(function (x) { return x.id === card.dataset.id; })[0];
        if (f) openDrawer(f);
      });
    });
  }

  function cardHtml(f) {
    var live = f.status === 'live';
    var cls = 'match-card' + (live ? ' is-live' : '');
    var pillCls = f.status === 'other' ? 'other' : f.status;
    var showScore = f.status !== 'upcoming';

    function row(side) {
      var t = f[side];
      var loser = f.status === 'finished' && f.home.score !== f.away.score &&
        ((side === 'home' && f.home.score < f.away.score) || (side === 'away' && f.away.score < f.home.score));
      return '<div class="mc-row">' +
        '<div class="mc-name' + (loser ? ' is-loser' : '') + '">' +
          '<span class="crest" style="background:' + esc(t.color) + '">' + esc(t.short) + '</span>' +
          '<span>' + esc(t.name) + '</span>' +
        '</div>' +
        '<div class="mc-score' + (showScore ? '' : ' is-muted') + '">' + (showScore ? t.score : '–') + '</div>' +
      '</div>';
    }

    var oddsBits = '';
    if (f.odds && f.odds.h && f.odds.h.cur) {
      oddsBits = '<div class="mc-odds">' +
        '<div class="odd-box"><em>主</em><b>' + fmtNum(f.odds.h.cur) + '</b></div>' +
        '<div class="odd-box"><em>平</em><b>' + fmtNum(f.odds.d.cur) + '</b></div>' +
        '<div class="odd-box"><em>客</em><b>' + fmtNum(f.odds.a.cur) + '</b></div>' +
      '</div>';
    }

    var timeMeta = f.status === 'upcoming'
      ? '<span class="kv">' + mmdd(f.kickoff) + ' ' + hhmm(f.kickoff) + '</span>'
      : '<span class="kv">' + mmdd(f.kickoff) + '</span>';

    return '<article class="' + cls + '" data-id="' + esc(f.id) + '">' +
      '<div class="mc-top">' +
        '<div class="mc-league"><b>' + esc(f.league.name) + '</b>' + timeMeta + '</div>' +
        '<span class="status-pill ' + pillCls + '">' + esc(statusPillText(f)) + '</span>' +
      '</div>' +
      '<div class="mc-teams">' + row('home') + row('away') + '</div>' +
      '<div class="mc-meta">' +
        '<span class="kv">角球 <b>' + f.corners.h + '-' + f.corners.a + '</b></span>' +
        '<span class="kv">黄牌 <b>' + f.cards.yh + '-' + f.cards.ya + '</b></span>' +
        (f.cards.rh || f.cards.ra ? '<span class="kv">红牌 <b>' + f.cards.rh + '-' + f.cards.ra + '</b></span>' : '') +
        oddsBits +
      '</div>' +
    '</article>';
  }

  /* ---------------- 抽屉 ---------------- */
  function openDrawer(f) {
    state.selected = f;
    state.drawerTab = 'stats';
    state.drawerMarket = '1x2';
    $('#drawerTitle').textContent = f.league.name + ' · ' +
      (f.status === 'live' ? '进行中' : (f.status === 'upcoming' ? '未开始' : (f.status === 'finished' ? '已结束' : (f.statusLabel || '—'))));
    $('#drawer').classList.add('is-open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#scrim').classList.add('is-open');
    renderDrawer();
  }
  function closeDrawer() {
    $('#drawer').classList.remove('is-open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#scrim').classList.remove('is-open');
    state.selected = null;
  }

  function drawerHead(f) {
    var mid = f.status === 'upcoming'
      ? '<span style="font-size:16px">' + hhmm(f.kickoff) + '</span><small>' + mmdd(f.kickoff) + ' 开赛</small>'
      : '<span>' + f.home.score + ' : ' + f.away.score + '</span><small>' + esc(statusPillText(f)) + '</small>';
    function side(t) {
      return '<div class="side">' +
        '<span class="crest" style="background:' + esc(t.color) + '">' + esc(t.short) + '</span>' +
        '<b>' + esc(t.name) + '</b></div>';
    }
    return '<div class="detail-head">' +
      '<div class="detail-league">' + esc(f.league.name) + (f.status === 'live' ? ' · LIVE' : '') + '</div>' +
      '<div class="detail-score">' + side(f.home) + '<div class="mid">' + mid + '</div>' + side(f.away) + '</div>' +
    '</div>';
  }

  function drawerTabsHtml() {
    var tabs = [['stats', '技术统计'], ['odds', '盘口赔率'], ['history', '赔率走势'], ['events', '事件']];
    return '<div class="d-tabs">' + tabs.map(function (t) {
      return '<button class="d-tab' + (state.drawerTab === t[0] ? ' is-active' : '') +
        '" data-dtab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  function renderDrawer() {
    var f = state.selected;
    if (!f) return;
    var body = $('#drawerBody');
    body.innerHTML = drawerHead(f) + drawerTabsHtml() + '<div id="dBody"></div>';
    $$('.d-tab', body).forEach(function (b) {
      b.addEventListener('click', function () {
        state.drawerTab = b.dataset.dtab;
        renderDrawer();
      });
    });
    var host = $('#dBody');
    if (state.drawerTab === 'stats') renderStatsTab(host, f);
    else if (state.drawerTab === 'odds') renderOddsTab(host, f);
    else if (state.drawerTab === 'history') renderHistoryTab(host, f);
    else renderEventsTab(host, f);
  }

  function renderStatsTab(host, f) {
    host.innerHTML = loadingBlock('加载技术统计…');
    ensureStats(f).then(function (rows) {
      if (!rows || !rows.length) {
        host.innerHTML = emptyBlock('暂无统计数据', '该场比赛可能尚未开始，或当前套餐不含此数据。');
        return;
      }
      host.innerHTML = rows.map(function (r) {
        var total = (r.h || 0) + (r.a || 0);
        var hp = total > 0 ? (r.h / total * 100) : 50;
        return '<div class="stat-row">' +
          '<div class="stat-top"><b>' + r.h + (r.unit || '') + '</b>' +
          '<span class="stat-label">' + esc(r.label) + '</span>' +
          '<b>' + r.a + (r.unit || '') + '</b></div>' +
          '<div class="stat-track"><i class="h" style="width:' + hp.toFixed(1) + '%"></i>' +
          '<i class="a" style="width:' + (100 - hp).toFixed(1) + '%"></i></div>' +
        '</div>';
      }).join('');
    }).catch(function (e) {
      host.innerHTML = errBlock(e);
    });
  }

  function renderOddsTab(host, f) {
    host.innerHTML = loadingBlock('加载盘口…');
    ensureOdds(f).then(function (groups) {
      if (!groups || !groups.length) {
        host.innerHTML = emptyBlock('暂无可解析的盘口', '该场赔率可能未开盘，或返回字段与当前解析器不匹配。');
        return;
      }
      host.innerHTML = groups.map(function (g) {
        return '<div class="odds-group"><h4>' + esc(g.label) + '</h4>' +
          '<table class="odds-table"><thead><tr>' +
          '<th>选项</th><th>开赔</th><th>即时</th><th>变动</th></tr></thead><tbody>' +
          g.outcomes.map(function (o) {
            var d = (o.cur - o.open);
            var pct = o.open ? (d / o.open * 100) : 0;
            return '<tr><td>' + esc(o.label) + '</td>' +
              '<td>' + fmtNum(o.open) + '</td>' +
              '<td class="cur">' + fmtNum(o.cur) + '</td>' +
              '<td class="' + moveClass(d) + '"><span class="mover-cell">' +
                moveArrow(d) + ' ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span></td></tr>';
          }).join('') +
          '</tbody></table></div>';
      }).join('') +
      '<p style="font-size:11.5px;color:var(--muted);margin:6px 0 0">红色为赔率上升，绿色为赔率下降。</p>';
    }).catch(function (e) {
      host.innerHTML = errBlock(e);
    });
  }

  function renderHistoryTab(host, f) {
    var markets = [['1x2', '1X2'], ['ah', '让球'], ['ou', '大小球'], ['corner', '角球'], ['card', '红黄牌']];
    var tabs = '<div class="mini-tabs">' + markets.map(function (m) {
      return '<button data-mk="' + m[0] + '" class="' + (state.drawerMarket === m[0] ? 'is-active' : '') + '">' + m[1] + '</button>';
    }).join('') + '</div>';

    host.innerHTML = tabs + loadingBlock('加载赔率历史…');
    $$('.mini-tabs button', host).forEach(function (b) {
      b.addEventListener('click', function () {
        state.drawerMarket = b.dataset.mk;
        renderHistoryTab(host, f);
      });
    });

    ensureHistory(f, state.drawerMarket).then(function (h) {
      var box = document.createElement('div');
      box.innerHTML = chartHtml(h, f);
      host.appendChild(box);
      var loader = host.querySelector('.loading-block');
      if (loader) loader.remove();
    }).catch(function (e) {
      var loader = host.querySelector('.loading-block');
      if (loader) loader.remove();
      host.insertAdjacentHTML('beforeend', errBlock(e));
    });
  }

  function renderEventsTab(host, f) {
    host.innerHTML = loadingBlock('加载事件…');
    ensureEvents(f).then(function (list) {
      if (!list || !list.length) {
        host.innerHTML = emptyBlock('暂无事件', '比赛尚未开始，或本场暂无进球/牌面事件。');
        return;
      }
      host.innerHTML = '<div class="event-list">' + list.map(function (e) {
        var ic = e.type === 'goal' ? '球' : (e.type === 'red' ? '红' : (e.type === 'yellow' ? '黄' : '·'));
        return '<div class="event">' +
          '<span class="min">' + e.minute + "'</span>" +
          '<span class="ic">' + ic + '</span>' +
          '<span class="txt"><b>' + esc(e.text) + '</b>' +
          (e.note ? '<em>' + esc(e.note) + '</em>' : '') + '</span>' +
        '</div>';
      }).join('') + '</div>';
    }).catch(function (e) {
      host.innerHTML = errBlock(e);
    });
  }

  function loadingBlock(txt) {
    return '<div class="loading-block" style="padding:32px 0;text-align:center;color:var(--muted);font-size:12.5px">' +
      '<span class="spinner" style="border-color:#e5e9ef;border-top-color:var(--accent)"></span>' + esc(txt) + '</div>';
  }
  function emptyBlock(title, sub) {
    return '<div class="empty"><b>' + esc(title) + '</b>' + esc(sub || '') + '</div>';
  }
  function errBlock(e) {
    return '<div class="banner err"><div><b>' + esc(e && e.message ? e.message : '加载失败') + '</b><br>' +
      esc(e && e.hint ? e.hint : '') + '</div></div>';
  }

  /* ---------------- 折线图 ---------------- */
  function chartHtml(h, f) {
    var series = (h && h.series) || [];
    if (!series.length) return emptyBlock('暂无赔率历史', '该盘口可能没有记录变动。');

    var W = 540, H = 200, padL = 38, padR = 12, padT = 14, padB = 26;
    var all = [];
    series.forEach(function (s) { s.points.forEach(function (p) { all.push(p.v); }); });
    if (!all.length) return emptyBlock('暂无赔率历史', '');
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    var span = max - min || 0.1;
    min -= span * 0.12; max += span * 0.12;

    var n = Math.max.apply(null, series.map(function (s) { return s.points.length; }));
    function X(i) { return padL + (n <= 1 ? 0 : (W - padL - padR) * i / (n - 1)); }
    function Y(v) { return padT + (H - padT - padB) * (1 - (v - min) / (max - min)); }

    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var val = min + (max - min) * g / 4;
      var y = Y(val);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="#e5e9ef" stroke-width="1" stroke-dasharray="' + (g === 0 ? '0' : '3 4') + '"/>';
      grid += '<text x="' + (padL - 6) + '" y="' + (y + 3.5).toFixed(1) +
        '" text-anchor="end" font-size="9.5" fill="#94a3b8">' + val.toFixed(2) + '</text>';
    }

    var paths = series.map(function (s) {
      var d = s.points.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(' ');
      var last = s.points[s.points.length - 1];
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="1.9" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>' +
        '<circle cx="' + X(s.points.length - 1).toFixed(1) + '" cy="' + Y(last.v).toFixed(1) +
        '" r="2.6" fill="#fff" stroke="' + s.color + '" stroke-width="1.8"/>';
    }).join('');

    var legend = '<div class="chart-legend">' + series.map(function (s) {
      var last = s.points[s.points.length - 1];
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) + ' ' + last.v.toFixed(2) + '</span>';
    }).join('') + '</div>';

    return legend + '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
      grid + paths +
      '<text x="' + padL + '" y="' + (H - 6) + '" font-size="9.5" fill="#94a3b8">开赔</text>' +
      '<text x="' + (W - padR) + '" y="' + (H - 6) + '" font-size="9.5" fill="#94a3b8" text-anchor="end">即时</text>' +
      '</svg></div>' +
      '<p style="font-size:11.5px;color:var(--muted);margin:8px 0 0">' +
      '横轴为赔率变动的时间序列，纵轴为小数赔率。数据点越密说明盘口调整越频繁。</p>';
  }

  /* ---------------- 积分榜 ---------------- */
  function renderStandingsChips() {
    var box = $('#slChips');
    box.innerHTML = FD.api.leagues.map(function (l) {
      return '<button class="chip' + (state.standingsLeague === l.id ? ' is-active' : '') +
        '" data-sl="' + l.id + '">' + esc(l.name) + '</button>';
    }).join('');
    $$('.chip', box).forEach(function (b) {
      b.addEventListener('click', function () {
        state.standingsLeague = parseInt(b.dataset.sl, 10);
        renderStandingsChips();
        loadStandings();
      });
    });
  }

  function loadStandings() {
    var wrap = $('#standingsWrap');
    wrap.innerHTML = '<div class="table-wrap"><div style="padding:40px;text-align:center;color:var(--muted);font-size:12.5px">' +
      '<span class="spinner" style="border-color:#e5e9ef;border-top-color:var(--accent)"></span>加载积分榜…</div></div>';

    var p = isApi()
      ? FD.api.standings(state.standingsLeague, state.standingsType)
      : Promise.resolve(FD.mock.standings(state.standingsLeague, state.standingsType));

    p.then(function (rows) {
      renderQuota();
      if (!rows || !rows.length) {
        wrap.innerHTML = emptyBlock('暂无榜单数据', '该联赛可能不在当前套餐覆盖范围内。');
        return;
      }
      wrap.innerHTML = state.standingsType === 'points' ? pointsTable(rows) : rankTable(rows, state.standingsType);
    }).catch(function (e) {
      renderQuota();
      wrap.innerHTML = errBlock(e);
    });
  }

  function posBar(pos, total) {
    var cls = pos <= 4 ? 'cl' : (pos <= 6 ? 'el' : (pos > total - 3 ? 'rl' : ''));
    return '<span class="pos-bar ' + cls + '"></span>';
  }

  function pointsTable(rows) {
    var html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>#</th><th class="tl">球队</th><th>场</th><th>胜</th><th>平</th><th>负</th>' +
      '<th>进</th><th>失</th><th>净</th><th>积分</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var gd = r.gd !== undefined ? r.gd : ((r.gf || 0) - (r.ga || 0));
      html += '<tr>' +
        '<td class="pos">' + r.pos + '</td>' +
        '<td class="tl"><div class="team-cell">' + posBar(r.pos, rows.length) +
          '<span class="crest" style="background:' + esc(r.color) + '">' + esc(r.short) + '</span>' +
          '<b>' + esc(r.team) + '</b></div></td>' +
        '<td>' + r.played + '</td><td>' + r.win + '</td><td>' + r.draw + '</td><td>' + r.loss + '</td>' +
        '<td>' + r.gf + '</td><td>' + r.ga + '</td>' +
        '<td class="' + (gd > 0 ? 'up' : (gd < 0 ? 'down' : 'flat')) + '">' + (gd > 0 ? '+' : '') + gd + '</td>' +
        '<td class="pts">' + r.pts + '</td></tr>';
    });
    return html + '</tbody></table></div>' +
      '<p style="font-size:11px;color:var(--muted);margin:10px 2px 0">' +
      '<span class="pos-bar cl"></span>欧冠区 <span class="pos-bar el" style="margin-left:10px"></span>欧联区 ' +
      '<span class="pos-bar rl" style="margin-left:10px"></span>降级区</p>';
  }

  function rankTable(rows, type) {
    var isCorner = type === 'corner';
    var head = isCorner
      ? '<th>#</th><th class="tl">球队</th><th>场</th><th>获得</th><th>被获</th><th>总角球</th><th>场均</th>'
      : '<th>#</th><th class="tl">球队</th><th>场</th><th>黄牌</th><th>红牌</th><th>总计</th><th>场均</th>';
    var html = '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var avg = r.avg || 0;
      html += '<tr>' +
        '<td class="pos">' + r.pos + '</td>' +
        '<td class="tl"><div class="team-cell">' + posBar(r.pos, rows.length) +
          '<span class="crest" style="background:' + esc(r.color) + '">' + esc(r.short) + '</span>' +
          '<b>' + esc(r.team) + '</b></div></td>' +
        '<td>' + r.played + '</td>' +
        (isCorner
          ? '<td>' + (r.for || 0) + '</td><td>' + (r.against || 0) + '</td><td>' + (r.total || 0) + '</td>'
          : '<td>' + (r.yellow || 0) + '</td><td>' + (r.red || 0) + '</td><td>' + (r.total || 0) + '</td>') +
        '<td class="pts">' + fmtNum(avg) + '</td></tr>';
    });
    return html + '</tbody></table></div>' +
      '<p style="font-size:11px;color:var(--muted);margin:10px 2px 0">按' +
      (isCorner ? '场均角球' : '场均已折算牌数（红牌按 2 计）') + '降序排列。</p>';
  }

  /* ---------------- 赔率变动监控 ---------------- */
  /* 列表接口不内嵌赔率，但用户点开过的比赛会缓存在 cache.odds；
     监控页把缓存里的 1X2 盘口合并进来，避免整页空白。 */
  function cachedOneXTwo(id) {
    var groups = cache.odds[id];
    if (!groups) return null;
    var g = groups.filter(function (x) { return x.key === '1x2'; })[0];
    if (!g || g.outcomes.length < 3) return null;
    var o = { h: {}, d: {}, a: {} };
    ['h', 'd', 'a'].forEach(function (slot, i) {
      o[slot] = { open: g.outcomes[i].open, cur: g.outcomes[i].cur };
    });
    return o;
  }

  function renderOddsMonitor() {
    var wrap = $('#oddsWrap');
    if (state.loading && !state.fixtures.length) {
      wrap.innerHTML = '<div class="table-wrap"><div style="padding:40px;text-align:center;color:var(--muted);font-size:12.5px">加载中…</div></div>';
      return;
    }
    var rows = state.fixtures.map(function (f) {
      var o = (f.odds && f.odds.h && f.odds.h.cur) ? f.odds : cachedOneXTwo(f.id);
      if (!o || !o.h || !o.h.cur) return null;
      var dh = o.h.cur - o.h.open, dd = o.d.cur - o.d.open, da = o.a.cur - o.a.open;
      return { f: f, odds: o, dh: dh, dd: dd, da: da, max: Math.max(Math.abs(dh), Math.abs(dd), Math.abs(da)) };
    }).filter(Boolean).sort(function (a, b) { return b.max - a.max; });

    if (!rows.length) {
      wrap.innerHTML = emptyBlock('暂无赔率数据',
        isApi() ? '免费层默认不随列表返回赔率，可在比赛详情里单独加载。' : '请稍后刷新。');
      return;
    }

    var html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>#</th><th class="tl">比赛</th><th>开赛</th>' +
      '<th>主胜 开→即</th><th>平局 开→即</th><th>客胜 开→即</th><th>最大变动</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r, i) {
      var f = r.f;
      function cell(o, d) {
        var pct = o.open ? (d / o.open * 100) : 0;
        return '<td class="' + moveClass(d) + '">' + fmtNum(o.open) + ' → <b>' + fmtNum(o.cur) + '</b>' +
          '<span style="font-size:10px;margin-left:4px">' + moveArrow(d) + (Math.abs(pct)).toFixed(1) + '%</span></td>';
      }
      html += '<tr>' +
        '<td class="pos">' + (i + 1) + '</td>' +
        '<td class="tl"><div class="team-cell">' +
          '<span class="crest" style="background:' + esc(f.home.color) + '">' + esc(f.home.short) + '</span>' +
          '<b>' + esc(f.home.name) + '</b><span style="color:var(--muted);font-size:11.5px;margin:0 4px">vs</span>' +
          '<b>' + esc(f.away.name) + '</b></div></td>' +
        '<td>' + (f.status === 'upcoming' ? hhmm(f.kickoff) : statusPillText(f)) + '</td>' +
        cell(r.odds.h, r.dh) + cell(r.odds.d, r.dd) + cell(r.odds.a, r.da) +
        '<td class="' + moveClass(r.max) + '"><b>' + r.max.toFixed(2) + '</b></td>' +
        '</tr>';
    });
    wrap.innerHTML = html + '</tbody></table></div>' +
      '<p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0">' +
      (isApi()
        ? '提示：免费层比赛列表不内嵌赔率，此表仅在已加载过赔率的比赛上有数据。'
        : '按三个选项中变动绝对值最大者降序排列。') + '</p>';
  }

  /* ---------------- 加载流程 ---------------- */
  function refresh(opts) {
    opts = opts || {};
    state.loading = true;
    state.error = null;
    $$('.banner.err').forEach(function (b) { b.remove(); });

    if (state.view === 'matches' || !opts.onlyCurrent) {
      if (state.view === 'matches') renderMatches();
    }

    ensureFixtures().then(function () {
      state.loading = false;
      state.lastUpdated = new Date();
      state.retryAt = null;
      renderQuota();
      if (state.view === 'matches') renderMatches();
      if (state.view === 'odds') renderOddsMonitor();
    }).catch(function (e) {
      state.loading = false;
      state.error = e;
      // 限流（429）时智能退避：把下次刷新推迟到额度重置时间，而不是继续按固定间隔硬撞
      if (e && e.code === 429) {
        var reset = e.resetTs || (Date.now() + 3600e3);
        state.retryAt = reset;
        state.nextTick = Math.ceil((reset - Date.now()) / 1000);
        $('#nextTick').textContent = state.nextTick;
      }
      renderQuota();
      renderMatches();
    });
  }

  function switchView(v) {
    state.view = v;
    $$('#tabs .tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.view === v); });
    $$('.view').forEach(function (s) { s.classList.toggle('is-active', s.id === 'view-' + v); });
    if (v === 'standings') { renderStandingsChips(); loadStandings(); }
    if (v === 'odds') renderOddsMonitor();
    if (v === 'matches') renderMatches();
  }

  /* ---------------- 计时器 ---------------- */
  function startTimers() {
    clearInterval(timers.clock);
    timers.clock = setInterval(function () {
      var d = new Date();
      $('#clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }, 1000);

    clearInterval(timers.countdown);
    timers.countdown = setInterval(function () {
      if (!FD.api.config.auto) { $('#nextTick').textContent = '--'; return; }
      state.nextTick = Math.max(0, state.nextTick - 1);
      $('#nextTick').textContent = state.nextTick;
      if (state.nextTick <= 0) {
        state.nextTick = FD.api.config.interval;
        refresh();
      }
    }, 1000);

    clearInterval(timers.mockTick);
    if (!isApi()) {
      timers.mockTick = setInterval(function () {
        FD.mock.tick();
        if (state.view === 'matches') renderMatches();
        if (state.selected) {
          state.selected = state.fixtures.filter(function (x) { return x.id === state.selected.id; })[0] || state.selected;
        }
      }, 8000);
    }
  }

  /* ---------------- 设置 ---------------- */
  function openModal() {
    $('#inpKey').value = FD.api.config.key;
    $('#inpBase').value = FD.api.config.base;
    if (FD.api.isProxy()) {
      // 代理模式下 Base 由服务端注入，前端不可改；Key 也不需要填
      $('#inpBase').setAttribute('readonly', 'readonly');
      $('#inpKey').setAttribute('readonly', 'readonly');
      $('#inpKey').placeholder = '已由本地代理注入，前端不持有密钥';
      $('#inpBase').placeholder = '/api（本地代理）';
    }
    $('#inpInterval').value = String(FD.api.config.interval);
    $('#inpAuto').checked = FD.api.config.auto;
    $('#modal').classList.add('is-open');
    $('#modal').setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    $('#modal').classList.remove('is-open');
    $('#modal').setAttribute('aria-hidden', 'true');
  }

  function bind() {
    $$('#tabs .tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });
    $$('#statusSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.statusFilter = b.dataset.status;
        $$('#statusSeg button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        renderMatches();
      });
    });
    $$('#stType button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.standingsType = b.dataset.type;
        $$('#stType button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        loadStandings();
      });
    });
    $('#btnRefresh').addEventListener('click', function () {
      cache = { stats: {}, odds: {}, history: {}, events: {} };
      if (state.view === 'standings') loadStandings(); else refresh();
      state.nextTick = FD.api.config.interval;
    });
    $('#btnSettings').addEventListener('click', openModal);
    $('#btnCloseModal').addEventListener('click', closeModal);
    $('#scrim').addEventListener('click', closeDrawer);
    $('#btnCloseDrawer').addEventListener('click', closeDrawer);
    $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeDrawer(); closeModal(); }
    });

    $('#btnSave').addEventListener('click', function () {
      var key = $('#inpKey').value.trim();
      var base = $('#inpBase').value.trim() || 'https://api.5dollarfootballapi.com/v1';
      var interval = parseInt($('#inpInterval').value, 10) || 300;
      var auto = $('#inpAuto').checked;
      FD.api.saveConfig({ key: key, base: base, interval: interval, auto: auto });
      closeModal();
      renderTopbar();
      cache = { stats: {}, odds: {}, history: {}, events: {} };
      state.fixtures = [];
      state.nextTick = interval;
      startTimers();
      refresh();
      if (state.view === 'standings') loadStandings();
    });

    $('#btnReset').addEventListener('click', function () {
      $('#inpKey').value = '';
      $('#inpBase').value = 'https://api.5dollarfootballapi.com/v1';
      $('#inpInterval').value = '120';
      $('#inpAuto').checked = true;
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    renderTopbar();
    renderLeagueChips();
    renderStandingsChips();
    bind();
    state.nextTick = FD.api.config.interval;
    $('#nextTick').textContent = FD.api.config.interval;
    startTimers();
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 调试入口：控制台可用 FD.debug.state / FD.debug.refresh() */
  FD.debug = { state: state, refresh: refresh, cache: function () { return cache; } };
})(window);
