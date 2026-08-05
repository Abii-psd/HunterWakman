// DoomSol Puppeteer — 10-Account Hurt Me Plenty 5000
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

// === LEVELSTAT: 5-episode Hurt Me Plenty = 5000 ===
const LEVELSTAT_5000 = [
  'E1M1 - 3:22.00 (0:06) K: 62/55 I: 30/38 S: 5/5',
  'E1M2 - 3:50.00 (0:07) K: 62/53 I: 31/36 S: 5/5',
  'E2M1 - 4:15.00 (0:07) K: 62/56 I: 32/40 S: 5/5',
  'E2M2 - 4:08.00 (0:07) K: 62/50 I: 32/35 S: 5/5',
  'E3M1 - 4:42.00 (0:08) K: 62/48 I: 30/32 S: 5/5'
].join('\n');

const SCORE_BREAKDOWN = [
  { kills: 62, items: 30, secrets: 5, score: 995 },
  { kills: 62, items: 31, secrets: 5, score: 1000 },
  { kills: 62, items: 32, secrets: 5, score: 1005 },
  { kills: 62, items: 32, secrets: 5, score: 1005 },
  { kills: 62, items: 30, secrets: 5, score: 995 }
];

// === WALLET ===
function deriveWallet(seedSk, index) {
  var seedKp = nacl.sign.keyPair.fromSecretKey(seedSk);
  var seedPub = bs58.encode(seedKp.publicKey);
  var hash = crypto.createHash('sha256').update(seedPub + ':' + index).digest();
  var newKp = nacl.sign.keyPair.fromSeed(hash.slice(0, 32));
  var names = ['Alpha','Bravo','Charlie','Delta','Echo','Fox','Ghost','Hawk','Ice','Jade',
    'Kilo','Lima','Mike','Nova','Oscar','Papa','Queen','Romeo','Sierra','Tango'];
  return {
    pubkey: bs58.encode(newKp.publicKey),
    secretKey: bs58.encode(newKp.secretKey),
    name: names[index % names.length],
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
  console.log('  Score: 5000 (Hurt Me Plenty 5-episode)');
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
    }, LEVELSTAT_5000);

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

    // Try submitting via page's fetch (credentialed, same-origin)
    if (!submitted) {
      var fetchOk = await page.evaluate((w) => {
        return fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: w.pubkey, name: w.name, game: 'DOOM',
            token: '', score: 5000, kills: 62*5, levels: 5
          })
        }).then(r => r.json()).then(j => j.ok === true).catch(() => false);
      }, wallet);
      if (fetchOk) injectMsg += ' fetch:ok';
      else injectMsg += ' fetch:no';
    }

    // Wait for response
    await sleep(6000);

    // Navigate game menu — try common button patterns
    if (!submitted) {
      await page.evaluate(() => {
        function tryClick(sel) {
          var el = document.querySelector(sel);
          if (el) { el.click(); return true; }
          return false;
        }
        // Try exact selectors first
        if (!tryClick('button:contains("Play")') &&
            !tryClick('button:contains("Start")') &&
            !tryClick('button:contains("New Game")')) {
          // Fallback: click all buttons
          var btns = document.querySelectorAll('button');
          for (var b of btns) {
            var t = (b.textContent || '').trim();
            if (t && t.length < 20) { b.click(); break; }
          }
        }
      });
      await sleep(6000);
    }

    result.debug = { inject: injectMsg, scan: scanResult, apiCalls: apiCalls };
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
  console.log('  Mode: HURT ME PLENTY | Score: 5000');
  console.log('  Seed PK: ' + SEED_PK.slice(0, 8) + '...');
  console.log('  Reward: ' + REWARD_WALLET);
  console.log('========================================');
  console.log('');

  console.log('Score breakdown (5 episodes):');
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
      accounts: NUM_ACCOUNTS, score: 5000, mode: 'hurtmeplenty',
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
