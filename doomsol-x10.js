// DoomSol Puppeteer — 10-Account Nightmare 5000
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

// === LEVELSTAT: 5-episode Hurt Me Plenty = 5000 score ===
// Score formula: 10*kills + 5*items + 25*secrets + 100 per level
// 995 + 1000 + 1005 + 1005 + 995 = 5000
// HMP: fewer max enemies, faster clear times than Nightmare
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

    // Hook FS.readFile BEFORE page loads — intercept levelstat read
    await page.evaluateOnNewDocument((data) => {
      window.__INJECTED_LEVELSTAT__ = data;
      // Intercept Object.defineProperty to catch Module when WASM sets it
      var origDefineProperty = Object.defineProperty;
      Object.defineProperty = function(obj, prop, desc) {
        origDefineProperty.call(Object, obj, prop, desc);
        if (prop === 'Module' && desc.value && desc.value.FS) {
          var FS = desc.value.FS;
          var origReadFile = FS.readFile;
          FS.readFile = function(path, opts) {
            if (path === '/levelstat.txt') {
              return window.__INJECTED_LEVELSTAT__;
            }
            return origReadFile.call(this, path, opts);
          };
          // Also write to FS so writeFile approach still works
          FS.writeFile('/levelstat.txt', data);
          window.__MODULE_HOOKED__ = true;
        }
      };
    }, LEVELSTAT_5000);

    // Track API calls
    page.on('response', async (res) => {
      var url = res.url();
      if (url.includes('/api/')) {
        var method = res.request().method();
        var status = res.status();
        apiCalls.push(method + ' ' + url.split('/api')[1] + ' -> ' + status);
      }
      if (url.includes('/api/score') && res.request().method() === 'POST') {
        try { var b = await res.json(); if (b.ok) submitted = true; } catch(e) {}
      }
    });

    // Load game — hook fires during WASM init
    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {});
    await sleep(6000);

    // Check if hook worked
    var hookStatus = await page.evaluate(() => {
      return {
        hooked: !!window.__MODULE_HOOKED__,
        hasModule: !!(window.Module && window.Module.FS),
        hasDOOM: !!window.__DOOM_MODULE
      };
    });
    var injectMsg = 'hook:' + hookStatus.hooked + ' module:' + hookStatus.hasModule;

    // Also try direct write as fallback
    if (!hookStatus.hooked) {
      var done = await page.evaluate((data) => {
        try {
          var m = window.Module || window.__DOOM_MODULE;
          if (m && m.FS) { m.FS.writeFile('/levelstat.txt', data); return 'ok-direct'; }
          return 'no-module';
        } catch(e) { return 'err'; }
      }, LEVELSTAT_5000);
      injectMsg += ' fallback:' + done;
    }

    result.debug = { inject: injectMsg, apiCalls: apiCalls };

    // Wait for game to process levelstat and submit
    await sleep(10000);

    // Try clicking start/new game to trigger levelstat processing
    if (!submitted) {
      await page.evaluate(() => {
        var btns = document.querySelectorAll('button, [role="button"], div[class*="button"], span[class*="button"]');
        for (var b of btns) {
          var t = (b.textContent || '').toLowerCase();
          if (t.includes('play') || t.includes('start') || t.includes('new game') || t.includes('begin') || t.includes('enter')) {
            b.click();
            return;
          }
        }
      });
      await sleep(8000);
    }

    if (!submitted) {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('beforeunload'));
      });
      await sleep(3000);
    }

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

  // Score breakdown
  console.log('Score breakdown (5 episodes):');
  var totalCheck = 0;
  SCORE_BREAKDOWN.forEach((s, i) => {
    console.log('  Ep ' + (i+1) + ': ' + s.kills + 'k + ' + s.items + 'i + ' + s.secrets + 's + 100 = ' + s.score);
    totalCheck += s.score;
  });
  console.log('  TOTAL: ' + totalCheck);
  console.log('');

  var seedSk = bs58.decode(SEED_PK);
  var results = [];
  var startTime = Date.now();

  // Launch browser
  log('Launching browser...');
  var browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
      '--use-gl=swiftshader', '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  // Warmup
  log('Warming up (caching assets)...');
  var warm = await browser.newPage();
  await warm.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(6000);
  await warm.close();
  log('Warmup done.');
  log('');

  // Submit accounts
  for (var i = 0; i < NUM_ACCOUNTS; i++) {
    var wallet = deriveWallet(seedSk, i);
    log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] Submitting: ' + wallet.name + ' (' + wallet.pubkey.slice(0,8) + '...)');

    var r = await submitOne(browser, wallet);
    results.push(r);

    if (r.ok) {
      log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] OK — score submitted');
    } else {
      var detail = r.debug ? ' [inject: ' + r.debug.inject + ']' : '';
      if (r.error) detail += ' [' + r.error + ']';
      if (r.debug && r.debug.apiCalls.length > 0) detail += ' [API: ' + r.debug.apiCalls.join(', ') + ']';
      log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] FAIL' + detail);
    }

    // Save progress after each account
    fs.writeFileSync('doomsol-x10-results.json', JSON.stringify({
      accounts: NUM_ACCOUNTS,
      score: 5000,
      mode: 'hurtmeplenty',
      rewardWallet: REWARD_WALLET,
      startedAt: new Date(startTime).toISOString(),
      lastUpdated: new Date().toISOString(),
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results: results
    }, null, 2));

    // Print report every 3 accounts
    if ((i + 1) % 3 === 0 || i === NUM_ACCOUNTS - 1) {
      printReport(results, startTime);
    }

    if (i < NUM_ACCOUNTS - 1) await sleep(DELAY_BETWEEN);
  }

  await browser.close();

  // Final report
  log('ALL DONE.');
  printReport(results, startTime);

  var okCount = results.filter(r => r.ok).length;
  log('Leaderboard: ' + GAME_URL);
  log('Results file: doomsol-x10-results.json');
  log('Check wallets for SOL, transfer to: ' + REWARD_WALLET);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
