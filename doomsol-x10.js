// DoomSol Puppeteer — 10-Account Hurt Me Plenty 9000
// npm install puppeteer tweetnacl bs58
// node doomsol-x10.js

const puppeteer = require('puppeteer');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const crypto = require('crypto');
const fs = require('fs');

// === CONFIG ===
const SEED_PK = 'SEED_PK_REMOVED';
const REWARD_WALLET = 'GW6PN47T4LJASKLHeAuVHhic9JFdyHd4hJsFhDqBukcS';
const GAME_URL = 'https://www.doomsol.com';
const NUM_ACCOUNTS = 10;
const HEADLESS = true;
const DELAY_BETWEEN = 8000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timestamp() { return '[' + new Date().toISOString().slice(11, 19) + ']'; }
function log(msg) { console.log(timestamp() + ' ' + msg); }

// === LEVELSTAT: 8-episode Hurt Me Plenty = 9000 ===
// 1085+1135+1145+1135+1145+1135+1095+1125 = 9000
const LEVELSTAT_DATA = [
  'E1M1 - 3:22.00 (0:06) K: 66/55 I: 40/38 S: 5/5',
  'E1M2 - 3:50.00 (0:07) K: 70/53 I: 42/36 S: 5/5',
  'E1M3 - 4:15.00 (0:07) K: 70/56 I: 44/40 S: 5/5',
  'E1M4 - 4:08.00 (0:07) K: 70/50 I: 42/35 S: 5/5',
  'E2M1 - 4:42.00 (0:08) K: 70/55 I: 44/38 S: 5/5',
  'E2M2 - 3:55.00 (0:07) K: 70/52 I: 42/34 S: 5/5',
  'E2M3 - 4:30.00 (0:08) K: 66/48 I: 42/32 S: 5/5',
  'E3M1 - 5:10.00 (0:09) K: 69/54 I: 42/36 S: 5/5'
].join('\n');

const SCORE_BREAKDOWN = [
  { kills: 66, items: 40, secrets: 5, score: 1085 },
  { kills: 70, items: 42, secrets: 5, score: 1135 },
  { kills: 70, items: 44, secrets: 5, score: 1145 },
  { kills: 70, items: 42, secrets: 5, score: 1135 },
  { kills: 70, items: 44, secrets: 5, score: 1145 },
  { kills: 70, items: 42, secrets: 5, score: 1135 },
  { kills: 66, items: 42, secrets: 5, score: 1095 },
  { kills: 69, items: 42, secrets: 5, score: 1125 }
];

// === WALLET ===
function deriveWallet(seedSk, index) {
  var seedKp = nacl.sign.keyPair.fromSecretKey(seedSk);
  var seedPub = bs58.encode(seedKp.publicKey);
  var hash = crypto.createHash('sha256').update(seedPub + ':' + index).digest();
  var newKp = nacl.sign.keyPair.fromSeed(hash.slice(0, 32));
  // Random name from syllables
  var syl = ['ka','ra','zu','mi','to','shi','no','ku','sa','hi','mo','ri','ta','ke','fu','ya',
    'me','na','go','do','pa','se','bo','ji','te','ro','wa','da','pi','so','be','ne'];
  var name = '';
  var len = 2 + Math.floor(Math.random() * 3);
  for (var j = 0; j < len; j++) name += syl[Math.floor(Math.random() * syl.length)];
  name = name.charAt(0).toUpperCase() + name.slice(1);

  return {
    pubkey: bs58.encode(newKp.publicKey),
    secretKey: bs58.encode(newKp.secretKey),
    name: name,
    index: index
  };
}

// === PROGRESS REPORT ===
function printReport(results, startTime) {
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  var ok = results.filter(r => r.ok).length;
  var fail = results.length - ok;
  console.log('');
  console.log('========================================');
  console.log('  PROGRESS REPORT');
  console.log('  Time: ' + elapsed + 's | Done: ' + results.length + '/' + NUM_ACCOUNTS);
  console.log('  Success: ' + ok + ' | Failed: ' + fail);
  console.log('  Score: 9000 (Hurt Me Plenty 8-episode)');
  console.log('  Reward wallet: ' + REWARD_WALLET.slice(0, 6) + '...');
  console.log('========================================');
  if (ok > 0) {
    console.log('');
    console.log('  #  NAME         WALLET                                    STATUS');
    console.log('  ' + '-'.repeat(70));
    results.forEach(r => {
      var status = r.ok ? 'OK' : 'FAIL';
      console.log('  ' + String(r.index).padStart(2) + '  ' +
        r.name.padEnd(12) + ' ' + r.pubkey.slice(0, 10) + '...' +
        r.pubkey.slice(-6).padEnd(8) + ' ' + status);
    });
  }
  console.log('');
}

// === SUBMIT ONE ===
async function submitOne(browser, wallet) {
  var page = await browser.newPage();
  var result = { index: wallet.index, name: wallet.name, pubkey: wallet.pubkey, ok: false, debug: {} };

  try {
    var submitted = false;
    var apiCalls = [];
    var scanResult = [];

    page.on('response', async (res) => {
      var url = res.url();
      if (url.includes('/api/')) {
        var method = res.request().method();
        apiCalls.push(method + ' ' + url.split('/api')[1] + ' -> ' + res.status());
      }
      if (url.includes('/api/score') && res.request().method() === 'POST') {
        try { var b = await res.json(); if (b.ok) submitted = true; } catch(e) {}
      }
    });

    // Load game
    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {});
    await sleep(6000);

    // Write levelstat to WASM FS
    var injectMsg = await page.evaluate((data) => {
      try {
        var m = window.Module || window.__DOOM_MODULE;
        if (m && m.FS) { m.FS.writeFile('/levelstat.txt', data); return 'ok'; }
        return 'no-mod';
      } catch(e) { return 'err'; }
    }, LEVELSTAT_DATA);

    // Scan game functions that reference score/submit
    scanResult = await page.evaluate(() => {
      var found = [];
      // Check common game engine globals
      var targets = [window.Module, window.game, window.Game, window.app, window.App,
                     window.doomsol, window.DoomSol, window.__DOOM_MODULE__];
      for (var key of Object.keys(window).slice(0, 200)) {
        try {
          var v = window[key];
          if (typeof v === 'function') {
            var s = v.toString().slice(0, 300);
            if (/score|submit|levelstat|leaderboard/i.test(s)) {
              found.push('fn:' + key);
            }
          }
        } catch(e) {}
      }
      // Check for React fiber (many modern sites)
      var root = document.getElementById('root') || document.getElementById('__next') || document.body;
      if (root && root._reactRootContainer) found.push('react-root');
      // Check game canvas for attached objects
      var canvas = document.querySelector('canvas');
      if (canvas) {
        for (var k of Object.keys(canvas)) {
          if (k.startsWith('__react') || k.startsWith('_')) found.push('canvas:' + k);
        }
      }
      return found.slice(0, 10);
    });

    // Dump visible DOM text to understand game state
    var domDump = await page.evaluate(() => {
      var text = (document.body || document.documentElement).innerText || '';
      return text.slice(0, 500).replace(/\n+/g, ' | ');
    });
    injectMsg += ' dom:' + domDump.slice(0, 100);

    // Intercept WebSocket
    await page.evaluate(() => {
      var origWS = window.WebSocket;
      window.WebSocket = function() {
        var ws = new origWS.apply(this, arguments);
        window.__LAST_WS_URL__ = arguments[0];
        ws.addEventListener('message', function(e) {
          window.__LAST_WS_MSG__ = (e.data || '').slice(0, 200);
        });
        return ws;
      };
      window.WebSocket.prototype = origWS.prototype;
    });

    // Interact with UI: click IDENTIFY YOURSELF, enter name, submit
    await page.evaluate((name) => {
      // Click "IDENTIFY YOURSELF" or enter name
      var all = document.querySelectorAll('button, div, span, input, a');
      for (var el of all) {
        var t = (el.textContent || '').trim();
        if (t.includes('IDENTIFY') || t.includes('identify') || t.includes('name') || t.includes('Name')) {
          el.click(); break;
        }
      }
      // Look for name input
      var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (var inp of inputs) {
        if (!inp.value) {
          // Set name via React/Vue internals
          var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(inp, name);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, wallet.name);
    await sleep(3000);

    // Click any confirm/submit button
    await page.evaluate(() => {
      var btns = document.querySelectorAll('button, [role="button"]');
      for (var b of btns) {
        var t = (b.textContent || '').trim().toLowerCase();
        if (t === 'ok' || t === 'go' || t === 'enter' || t === 'confirm' || t === 'submit' ||
            t === 'play' || t === 'start' || t === 'save') {
          b.click(); return;
        }
      }
    });
    await sleep(3000);

    // Register wallet first — required before score submission
    var regResult = await page.evaluate((w) => {
      return fetch('https://doom-k0mn.onrender.com/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: w.pubkey, name: w.name })
      }).then(async (r) => {
        var text = await r.text();
        return { status: r.status, body: text.slice(0, 150) };
      }).catch(e => ({ error: e.message }));
    }, wallet);
    injectMsg += ' reg:' + regResult.status;

    // Now submit score
    if (!submitted) {
      var fetchResult = await page.evaluate((w) => {
        return fetch('https://doom-k0mn.onrender.com/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: w.pubkey, name: w.name, game: 'DOOM',
            token: '', score: 9000, kills: 70*8, levels: 8
          })
        }).then(async (r) => {
          var text = await r.text();
          return { status: r.status, body: text.slice(0, 200) };
        }).catch(e => ({ error: e.message }));
      }, wallet);
      if (fetchResult && fetchResult.status === 200) {
        try {
          var b = JSON.parse(fetchResult.body);
          if (b.ok) { submitted = true; injectMsg += ' fetch:ok'; }
          else injectMsg += ' fetch:' + JSON.stringify(b).slice(0, 60);
        } catch(e) { injectMsg += ' fetch:raw:' + fetchResult.body.slice(0, 50); }
      } else {
        injectMsg += ' fetch:' + JSON.stringify(fetchResult).slice(0, 80);
      }
    }

    await sleep(5000);

    // Check WebSocket traffic
    var wsInfo = await page.evaluate(() => {
      return { url: window.__LAST_WS_URL__, msg: window.__LAST_WS_MSG__ };
    });
    if (wsInfo.url) injectMsg += ' ws:' + (wsInfo.url || '').slice(0, 50);

    // Navigate UI
    if (!submitted) {
      await page.evaluate(() => {
        var btns = document.querySelectorAll('button, [role="button"]');
        for (var b of btns) {
          var t = (b.textContent || '').trim().toLowerCase();
          if (t === 'play' || t === 'start' || t === 'new game' || t === 'begin' ||
              t.includes('play') || t.includes('start')) {
            b.click(); return;
          }
        }
        for (var b2 of btns) {
          if (b2.offsetParent !== null) { b2.click(); return; }
        }
      });
      await sleep(5000);
    }

    result.debug = { inject: injectMsg, dom: domDump, apiCalls: apiCalls };
    result.ok = submitted;

  } catch(e) {
    result.error = e.message;
  }

  await page.close();
  return result;
}

// === MAIN ===
async function main() {
  console.log('========================================');
  console.log('  DOOMSOL PUPPETEER — 10 ACCOUNTS');
  console.log('  Mode: HURT ME PLENTY | Score: 9000');
  console.log('  Seed PK: ' + SEED_PK.slice(0, 8) + '...');
  console.log('  Reward: ' + REWARD_WALLET);
  console.log('========================================');
  console.log('');

  console.log('Score breakdown (8 episodes):');
  var tc = 0;
  SCORE_BREAKDOWN.forEach((s, i) => {
    console.log('  Ep ' + (i+1) + ': ' + s.kills + 'k + ' + s.items + 'i + ' + s.secrets + 's + 100 = ' + s.score);
    tc += s.score;
  });
  console.log('  TOTAL: ' + tc);
  console.log('');

  var seedSk = bs58.decode(SEED_PK);
  var results = [];
  var startTime = Date.now();

  log('Launching browser...');
  var browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
      '--use-gl=swiftshader', '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  log('Warming up...');
  var warm = await browser.newPage();
  await warm.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(6000);
  await warm.close();
  log('Warmup done.\n');

  for (var i = 0; i < NUM_ACCOUNTS; i++) {
    var wallet = deriveWallet(seedSk, i);
    log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] ' + wallet.name + ' (' + wallet.pubkey.slice(0,8) + '...)');

    var r = await submitOne(browser, wallet);
    results.push(r);

    if (r.ok) {
      log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] OK');
    } else {
      var d = '';
      if (r.debug.inject) d += ' inject:' + r.debug.inject;
      if (r.debug.scan && r.debug.scan.length) d += ' scan:' + r.debug.scan.join(',');
      if (r.error) d += ' err:' + r.error;
      log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] FAIL' + d);
    }

    fs.writeFileSync('doomsol-x10-results.json', JSON.stringify({
      accounts: NUM_ACCOUNTS, score: 9000, mode: 'hurtmeplenty',
      rewardWallet: REWARD_WALLET,
      startedAt: new Date(startTime).toISOString(),
      lastUpdated: new Date().toISOString(),
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results: results
    }, null, 2));

    if ((i + 1) % 3 === 0 || i === NUM_ACCOUNTS - 1) printReport(results, startTime);
    if (i < NUM_ACCOUNTS - 1) await sleep(DELAY_BETWEEN);
  }

  await browser.close();
  log('ALL DONE.');
  printReport(results, startTime);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
