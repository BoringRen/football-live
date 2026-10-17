/* =========================================================
   Vercel Serverless Function —— 5DollarFootballAPI 反向代理

   对应本地 proxy.js 的 /api/* 部分。部署到 Vercel 后：
     https://<你的项目>.vercel.app/api/fixtures  →  https://api.5dollarfootballapi.com/v1/fixtures
   密钥从环境变量 FD_KEY 读取，永远不进前端、不进仓库。

   用法：
     1. 在 Vercel 项目里配置环境变量 FD_KEY=fb_xxx
     2. vercel.json 已把 /api/* 路由到本函数
   ========================================================= */
'use strict';

var https = require('https');

var UPSTREAM = 'https://api.5dollarfootballapi.com/v1';

module.exports = async function handler(req, res) {
  var KEY = process.env.FD_KEY || '';

  // 健康探测端点：前端 index.html 加载时会 fetch('/api/status') 判断是否走代理。
  // 这里直接返回 200，不转发上游，避免浪费配额、也避免上游无此端点导致误判。
  var rawPath = (req.query && req.query.__path) || (req.headers['x-vercel-path']) || req.url || '/';
  if (/^\/api\/status(\?|$)/.test(rawPath)) {
    res.status(200).json({
      success: true,
      proxy: true,
      key_configured: !!KEY
    });
    return;
  }

  if (!KEY) {
    res.status(500).json({
      success: false,
      message: '代理未配置 API Key',
      hint: '请在 Vercel 项目设置里添加环境变量 FD_KEY=fb_xxx'
    });
    return;
  }

  // 还原上游路径（rawPath 已在上方算好）。
  // Vercel rewrite 后，原始请求路径保存在 req.url（含 /api 前缀与查询串）。
  // 若部署平台把路径放到 query.__path 或 header，也一并兼容。
  // 去掉 /api 前缀，拼到上游（保留查询串）
  var sub = rawPath.replace(/^\/api/, '');
  if (!sub || sub.charAt(0) !== '/') sub = '/' + (sub || '');
  var target = UPSTREAM + sub;

  try {
    var upstream = await forward(target, KEY);
    // 透传配额相关响应头，方便前端显示真实剩余量
    var headers = { 'Cache-Control': 'no-store' };
    Object.keys(upstream.headers).forEach(function (k) {
      if (/^(x-)?rate|^x-request|^retry-after/i.test(k)) headers[k] = upstream.headers[k];
    });
    res.status(upstream.status).set(headers);
    res.send(upstream.body);
  } catch (e) {
    res.status(502).json({
      success: false,
      message: '无法连接 5DollarFootballAPI：' + e.message
    });
  }
};

function forward(target, key) {
  return new Promise(function (resolve, reject) {
    var up = https.request(target, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Accept': 'application/json',
        'User-Agent': 'football-live-vercel/1.0'
      },
      timeout: 20000
    }, function (r) {
      var chunks = [];
      r.on('data', function (c) { chunks.push(c); });
      r.on('end', function () {
        var body = Buffer.concat(chunks);
        resolve({
          status: r.statusCode || 502,
          headers: r.headers,
          body: body
        });
      });
    });
    up.on('timeout', function () { up.destroy(new Error('上游超时')); });
    up.on('error', reject);
    up.end();
  });
}
