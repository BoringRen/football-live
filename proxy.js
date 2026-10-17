/* =========================================================
   proxy.js —— 本地静态服务 + 5DollarFootballAPI 反向代理
   零依赖，只用 Node 内置模块。

   作用：
     1. 静态托管当前目录（index.html / assets/*）
     2. /api/*  →  https://api.5dollarfootballapi.com/v1/*
        并把 Authorization: Bearer <key> 注入在服务端，
        浏览器端永远看不到密钥，也绕过了 CORS。
     3. 给 index.html 注入 window.__FD_PROXY_BASE__ = '/api'，
        前端检测到它就直接走代理，无需在设置里填任何东西。

   用法：
     node proxy.js --key=fb_xxxxxxxx        # 推荐
     FD_KEY=fb_xxxxxxxx node proxy.js       # 或环境变量
     node proxy.js --port=8787
   ========================================================= */
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var url = require('url');

var UPSTREAM = 'https://api.5dollarfootballapi.com/v1';

/* ---------------- 参数 ---------------- */
var argv = process.argv.slice(2);
function arg(name, dflt) {
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--' + name && argv[i + 1]) return argv[i + 1];
    if (argv[i].indexOf('--' + name + '=') === 0) return argv[i].slice(name.length + 3);
  }
  return dflt;
}
var PORT = parseInt(arg('port', process.env.PORT || '8787'), 10);
var KEY = arg('key', process.env.FD_KEY || '');
var ROOT = path.resolve(__dirname);

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

/* ---------------- 工具 ---------------- */
function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  });
  res.end(body);
}

function log(tag, msg) {
  var t = new Date().toTimeString().slice(0, 8);
  console.log('[' + t + '] ' + tag + ' ' + msg);
}

/* ---------------- 反向代理 ---------------- */
function proxy(req, res) {
  var sub = req.url.replace(/^\/api/, '');
  if (sub.charAt(0) !== '/') sub = '/' + sub;

  // 健康探测：前端探测脚本会 fetch /api/status，这里直接回 200，不转发上游
  if (/^\/status(\?|$)/.test(sub)) {
    return send(res, 200, JSON.stringify({ success: true, proxy: true, key_configured: !!KEY }));
  }

  if (!KEY) {
    log('WARN', '未配置 API Key，拒绝转发 ' + sub);
    return send(res, 500, JSON.stringify({
      success: false,
      message: '代理未配置 API Key',
      hint: '启动时加 --key=fb_xxxx，或设置环境变量 FD_KEY'
    }));
  }

  var target = UPSTREAM + sub;
  var headers = {
    'Authorization': 'Bearer ' + KEY,
    'Accept': 'application/json',
    'User-Agent': 'football-live-proxy/1.0'
  };

  var up = https.request(target, { method: 'GET', headers: headers, timeout: 20000 }, function (r) {
    var chunks = [];
    r.on('data', function (c) { chunks.push(c); });
    r.on('end', function () {
      var body = Buffer.concat(chunks);
      // 把上游的配额相关响应头透传给前端，方便 UI 显示真实剩余量
      var pass = {};
      Object.keys(r.headers).forEach(function (k) {
        if (/^(x-)?rate|^x-request|^retry-after/i.test(k)) pass[k] = r.headers[k];
      });
      res.writeHead(r.statusCode || 502, Object.assign({
        'Content-Type': r.headers['content-type'] || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }, pass));
      res.end(body);
      log(r.statusCode >= 400 ? 'FAIL' : 'OK  ', sub + ' → ' + r.statusCode + ' (' + body.length + 'B)' +
        (r.headers['x-ratelimit-remaining'] ? ' 剩余 ' + r.headers['x-ratelimit-remaining'] : ''));
    });
  });

  up.on('timeout', function () { up.destroy(new Error('上游超时')); });
  up.on('error', function (e) {
    log('ERR ', sub + ' → ' + e.message);
    send(res, 502, JSON.stringify({
      success: false,
      message: '无法连接 5DollarFootballAPI：' + e.message
    }));
  });
  up.end();
}

/* ---------------- 静态页面 ---------------- */
function serveFile(req, res, pathname) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  var file = path.join(ROOT, decodeURIComponent(pathname.split('?')[0]));
  if (file.indexOf(ROOT) !== 0) return send(res, 403, 'forbidden', 'text/plain; charset=utf-8');

  fs.readFile(file, function (err, buf) {
    if (err) return send(res, 404, 'Not Found: ' + pathname, 'text/plain; charset=utf-8');
    var ext = path.extname(file).toLowerCase();

    if (ext === '.html') {
      // 只有配好 Key 才注入代理地址；
      // 没 Key 时保持原样，前端会自动退回演示模式，不会白屏报错。
      var html = buf.toString('utf-8');
      if (KEY) {
        html = html.replace(
          /<head([^>]*)>/i,
          '<head$1>\n<script>window.__FD_PROXY_BASE__="/api";</script>'
        );
      }
      return send(res, 200, html, MIME['.html']);
    }
    send(res, 200, buf, MIME[ext] || 'application/octet-stream');
  });
}

/* ---------------- 启动 ---------------- */
var server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  var pathname = url.parse(req.url).pathname;
  if (pathname.indexOf('/api') === 0) return proxy(req, res);
  serveFile(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('');
  console.log('  Football Live · 实时数据台');
  console.log('  ----------------------------------------');
  console.log('  本地地址   http://127.0.0.1:' + PORT + '/');
  console.log('  上游接口   ' + UPSTREAM);
  console.log('  API Key    ' + (KEY ? KEY.slice(0, 8) + '…（已注入，前端不可见）' : '未配置 —— 页面会停在演示模式'));
  console.log('  ----------------------------------------');
  if (!KEY) console.log('  配 Key：node proxy.js --key=fb_xxxxxxxx');
  console.log('');
});
