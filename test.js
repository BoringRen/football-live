/* 渲染验证：在 jsdom 里真实加载页面，检查运行时错误与关键 DOM
   用法：node test.js            （默认连 http://127.0.0.1:8123）
        PORT=8787 node test.js  （指定端口） */
const { JSDOM, VirtualConsole } = require('jsdom');

const PORT = process.env.PORT || 8123;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('[jsdomError] ' + e.message));
  vc.on('error', (...a) => errors.push('[console.error] ' + a.join(' ')));

  const dom = await JSDOM.fromURL(ORIGIN + '/index.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      // jsdom 没有 fetch，用 Node 原生 fetch 顶上（相对路径补全为绝对地址）
      win.fetch = (input, init) => {
        const u = typeof input === 'string' && input.startsWith('/') ? ORIGIN + input : input;
        return fetch(u, init);
      };
      win.AbortController = AbortController;
      win.Response = Response;
      win.Headers = Headers;
      win.Request = Request;
    },
  });

  const win = dom.window;
  win.addEventListener('error', (e) => errors.push('[window.error] ' + e.message));
  await wait(3200);

  const doc = win.document;
  const q = (s) => doc.querySelectorAll(s).length;
  const txt = (s) => (doc.querySelector(s) || {}).textContent || '';

  const report = {};
  report.cards = q('.match-card');
  report.liveBadges = q('.status-pill.live');
  report.leagueChips = q('#leagueChips .chip');
  report.sourceBadge = txt('#sourceBadge').trim();
  report.quotaText = txt('#quotaText').trim();
  report.firstCardText = (doc.querySelector('.match-card') || {}).textContent || '';

  // 1) 点击第一张卡片 → 抽屉
  const firstCard = doc.querySelector('.match-card');
  if (firstCard) firstCard.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(900);
  report.drawerOpen = doc.querySelector('#drawer').classList.contains('is-open');
  report.drawerTitle = txt('#drawerTitle').trim();
  report.statRows = q('.stat-row');

  // 2) 切到盘口
  const oddsTab = doc.querySelector('.d-tab[data-dtab="odds"]');
  if (oddsTab) oddsTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1100);
  report.oddsTables = q('.odds-table');
  report.oddsRows = q('.odds-table tbody tr');
  report.oddsFirstRow = (doc.querySelector('.odds-table tbody tr') || {}).textContent || '';

  // 3) 切到赔率走势
  const histTab = doc.querySelector('.d-tab[data-dtab="history"]');
  if (histTab) histTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1200);
  report.chartSvg = q('.chart-box svg');
  report.chartPaths = q('.chart-box svg path');
  report.legend = q('.chart-legend span');

  // 4) 切到事件
  const evTab = doc.querySelector('.d-tab[data-dtab="events"]');
  if (evTab) evTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1100);
  report.events = q('.event');

  // 5) 关闭抽屉 → 积分榜
  doc.querySelector('#btnCloseDrawer').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);
  doc.querySelector('.tab[data-view="standings"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1200);
  report.standingsRows = q('#standingsWrap tbody tr');
  report.standingsHeaders = Array.from(doc.querySelectorAll('#standingsWrap thead th')).map((t) => t.textContent.trim());

  // 6) 角球榜
  const cornerBtn = doc.querySelector('#stType button[data-type="corner"]');
  if (cornerBtn) cornerBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(1100);
  report.cornerRows = q('#standingsWrap tbody tr');
  report.cornerHeaders = Array.from(doc.querySelectorAll('#standingsWrap thead th')).map((t) => t.textContent.trim());
  report.cornerFirstRow = (doc.querySelector('#standingsWrap tbody tr') || {}).textContent || '';

  // 7) 赔率变动
  doc.querySelector('.tab[data-view="odds"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(900);
  report.oddsMonitorRows = q('#oddsWrap tbody tr');
  report.oddsMonitorFirst = (doc.querySelector('#oddsWrap tbody tr') || {}).textContent || '';

  // 8) 筛选交互
  doc.querySelector('.tab[data-view="matches"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(300);
  const liveBtn = doc.querySelector('#statusSeg button[data-status="live"]');
  if (liveBtn) liveBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(200);
  report.afterLiveFilter = q('.match-card');
  report.afterLiveFilterAllLive = Array.from(doc.querySelectorAll('.match-card'))
    .every((c) => c.classList.contains('is-live'));

  console.log('===== REPORT =====');
  console.log(JSON.stringify(report, null, 1));
  console.log('===== ERRORS (' + errors.length + ') =====');
  errors.slice(0, 10).forEach((e) => console.log(e));

  dom.window.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
