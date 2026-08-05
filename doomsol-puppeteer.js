// DoomSol Puppeteer Farmer — Multi-Account WASM Levelstat Injection
// Requires: npm install puppeteer tweetnacl bs58
// Usage: node doomsol-puppeteer.js
//
// Opens real browser, injects levelstat into DOOM WASM filesystem,
// submits verified scores that appear on the leaderboard.
// Loops through all accounts with one browser session.

const puppeteer = require('puppeteer');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const crypto = require('crypto');
const fs = require('fs');

// === CONFIG ===
const SEED_PK = 'OLD_SEED_PK_REMOVED';
const REWARD_WALLET = 'GW6PN47T4LJASKLHeAuVHhic9JFdyHd4hJsFhDqBukcS';
const GAME_URL = 'https://www.doomsol.com';
const START_INDEX = 0;         // first account index
const NUM_ACCOUNTS = 100;      // how many accounts to submit this run
const HEADLESS = true;         // set false to see browser
const MODE = 'nightmare';      // 'nightmare' | 'normal'
const TARGET_SCORE = 2500;     // 2500 for nightmare, ~300 for normal
const DELAY_BETWEEN = 5000;    // ms between accounts (avoid rate limit)
const PAGE_TIMEOUT = 45000;    // max ms per account

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// === LEVELSTAT GENERATOR ===
function generateLevelstat(mode, targetScore) {
  if (mode === 'nightmare') return generateNightmare(targetScore);
  return generateNormal(targetScore);
}

function generateNormal(targetScore) {
  var kills = Math.floor(targetScore * 0.40 / 10);
  var items = Math.floor(targetScore * 0.30 / 5);
  var secrets = Math.floor(targetScore * 0.20 / 25);
  var minutes = 1 + Math.floor(Math.random() * 3);
  var seconds = Math.floor(Math.random() * 60);
  var timeStr = minutes + ':' + String(seconds).padStart(2, '0') + '.00';
  var penaltyStr = '0:' + String(Math.floor(seconds * 0.7)).padStart(2, '0');
  var maxKills = kills + Math.floor(Math.random() * 20);
  var maxItems = items + Math.floor(Math.random() * 15);
  var maxSecrets = secrets + Math.floor(Math.random() * 3) + 1;
  return 'E1M1 - ' + timeStr + ' (' + penaltyStr + ') K: ' + kills + '/' + maxKills +
         ' I: ' + items + '/' + maxItems + ' S: ' + secrets + '/' + maxSecrets;
}

function generateNightmare(targetScore) {
  // 3 episodes: E1M1 930 + E2M1 810 + E3M1 760 = 2500
  var levels = [
    { ep: 'E1M1', kills: 63, maxK: 78, items: 25, maxI: 40, secrets: 3, maxS: 5, min: 4, sec: 12 },
    { ep: 'E2M1', kills: 55, maxK: 70, items: 22, maxI: 36, secrets: 2, maxS: 4, min: 5, sec: 33 },
    { ep: 'E3M1', kills: 52, maxK: 65, items: 18, maxI: 30, secrets: 2, maxS: 3, min: 6, sec: 47 }
  ];
  var lines = [];
  for (var l of levels) {
    var timeStr = l.min + ':' + String(l.sec).padStart(2, '0') + '.00';
    var penaltyStr = '0:' + String(Math.floor(l.sec * 0.6)).padStart(2, '0');
    lines.push(l.ep + ' - ' + timeStr + ' (' + penaltyStr + ') K: ' + l.kills + '/' + l.maxK +
               ' I: ' + l.items + '/' + l.maxI + ' S: ' + l.secrets + '/' + l.maxS);
  }
  return lines.join('\n');
}

// === WALLET DERIVATION ===
function deriveWallet(seedSk, index) {
  var seedKp = nacl.sign.keyPair.fromSecretKey(seedSk);
  var seedPub = bs58.encode(seedKp.publicKey);
  var hash = crypto.createHash('sha256').update(seedPub + ':' + index).digest();
  var newKp = nacl.sign.keyPair.fromSeed(hash.slice(0, 32));
  var prefixes = ['Alpha','Bravo','Charlie','Delta','Echo','Fox','Ghost','Hawk','Ice','Jade',
    'Kilo','Lima','Mike','Nova','Oscar','Papa','Queen','Romeo','Sierra','Tango',
    'Ultra','Victor','Whisky','Xray','Yankee','Zulu','Storm','Blade','Fang','Wolf'];
  return {
    pubkey: bs58.encode(newKp.publicKey),
    secretKey: bs58.encode(newKp.secretKey),
    name: prefixes[index % prefixes.length] + (Math.floor(index / prefixes.length) || ''),
    index: index
  };
}

// === SUBMIT ONE ACCOUNT ===
async function submitAccount(browser, wallet, levelstat, log) {
  var page = await browser.newPage();
  var result = { index: wallet.index, name: wallet.name, pubkey: wallet.pubkey, ok: false };

  try {
    // Track API calls
    var submitted = false;
    page.on('response', async (response) => {
      var url = response.url();
      if (url.includes('/api/score') && response.request().method() === 'POST') {
        try {
          var body = await response.json();
          if (body.ok) { submitted = true; result.ok = true; }
        } catch(e) {}
      }
    });

    // Load game
    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for WASM canvas
    await page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {});

    // Give WASM time to boot
    await sleep(4000);

    // Try to access Module.FS and inject levelstat
    var injected = await page.evaluate((data) => {
      try {
        var mod = window.Module || window.__DOOM_MODULE;
        if (mod && mod.FS) {
          mod.FS.writeFile('/levelstat.txt', data);
          return true;
        }
        return false;
      } catch(e) { return false; }
    }, levelstat);

    if (!injected) {
      // Try hook approach
      await page.evaluate(() => {
        var orig = Object.defineProperty;
        Object.defineProperty = function(obj, prop, desc) {
          orig.call(Object, obj, prop, desc);
          if (prop === 'Module' && desc.value && desc.value.FS) {
            window.__DOOM_MODULE = desc.value;
          }
        };
      });
      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(6000);
      injected = await page.evaluate((data) => {
        var mod = window.Module || window.__DOOM_MODULE;
        if (mod && mod.FS) {
          mod.FS.writeFile('/levelstat.txt', data);
          return true;
        }
        return false;
      }, levelstat);
    }

    // Wait for game to process levelstat and submit score
    await sleep(8000);

    // If score not auto-submitted, try triggering UI
    if (!submitted) {
      await page.evaluate(() => {
        // Click any play/start button
        var btns = document.querySelectorAll('button, [role="button"], .btn');
        for (var b of btns) {
          var t = (b.textContent || '').toLowerCase();
          if (t.includes('play') || t.includes('start') || t.includes('new') || t.includes('enter')) {
            b.click();
            return;
          }
        }
        // Trigger unload to force save
        window.dispatchEvent(new Event('beforeunload'));
      });
      await sleep(5000);
    }

    if (submitted) {
      log('OK  #' + wallet.index + ' ' + wallet.name + ' (' + wallet.pubkey.slice(0,8) + '...)');
    } else {
      log('??  #' + wallet.index + ' ' + wallet.name + ' — no API call detected');
    }

  } catch(e) {
    log('ERR #' + wallet.index + ' ' + wallet.name + ' — ' + e.message);
  }

  await page.close();
  return result;
}

// === MAIN ===
async function main() {
  console.log('=== DOOMSOL PUPPETEER MULTI-FARMER ===');
  console.log('Mode: ' + MODE + ' | Score: ' + TARGET_SCORE);
  console.log('Accounts: ' + START_INDEX + '-' + (START_INDEX + NUM_ACCOUNTS - 1) + ' (' + NUM_ACCOUNTS + ' total)');
  console.log('Delay: ' + DELAY_BETWEEN + 'ms between accounts');
  console.log('');

  var seedSk = bs58.decode(SEED_PK);

  // Generate levelstat once (same for all accounts, game doesn't track)
  var levelstat = generateLevelstat(MODE, TARGET_SCORE);
  console.log('Levelstat (' + MODE + '):');
  console.log(levelstat);
  console.log('');

  // Launch browser once
  console.log('Launching browser...');
  var browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
      '--use-gl=swiftshader', '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  var results = [];
  var okCount = 0;
  var errCount = 0;
  var startTime = Date.now();

  // Warm up: load once to cache assets
  console.log('Warming up (loading game once to cache)...');
  var warmPage = await browser.newPage();
  await warmPage.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(5000);
  await warmPage.close();
  console.log('Warmup done. Starting accounts...\n');

  // Submit each account
  for (var i = 0; i < NUM_ACCOUNTS; i++) {
    var idx = START_INDEX + i;
    var wallet = deriveWallet(seedSk, idx);

    var elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    var eta = NUM_ACCOUNTS - i - 1;
    var etaStr = eta > 0 ? ' | ETA: ' + Math.round(eta * (Date.now() - startTime) / (i+1) / 1000) + 's' : '';

    var prefix = '[' + (i+1) + '/' + NUM_ACCOUNTS + ' ' + elapsed + 's' + etaStr + '] ';
    var r = await submitAccount(browser, wallet, levelstat, function(msg) {
      console.log(prefix + msg);
    });

    if (r.ok) okCount++; else errCount++;
    results.push(r);

    // Save progress
    fs.writeFileSync('puppeteer-results.json', JSON.stringify({
      ok: okCount, errors: errCount, total: i+1,
      lastIndex: idx, results: results
    }, null, 2));

    // Delay between accounts
    if (i < NUM_ACCOUNTS - 1) await sleep(DELAY_BETWEEN);
  }

  await browser.close();

  // Final report
  var totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('');
  console.log('========================================');
  console.log('DONE: ' + okCount + '/' + NUM_ACCOUNTS + ' OK in ' + totalTime + 's');
  console.log('Errors: ' + errCount);
  console.log('Results saved: puppeteer-results.json');
  console.log('========================================');

  if (okCount > 0) {
    console.log('');
    console.log('Check leaderboard: ' + GAME_URL);
    console.log('Accounts submitted:');
    results.filter(r => r.ok).forEach(r => {
      console.log('  #' + r.index + ' ' + r.name.padEnd(12) + ' ' + r.pubkey);
    });
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
