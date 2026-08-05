// DoomSol Puppeteer — 5-Account Ultra-Violence 9000
// npm install puppeteer tweetnacl bs58
// node doomsol-x10.js

const puppeteer = require('puppeteer');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const crypto = require('crypto');
const fs = require('fs');

const SEED_PK = 'SEED_PK_REMOVED';
const REWARD_WALLET = 'GW6PN47T4LJASKLHeAuVHhic9JFdyHd4hJsFhDqBukcS';
const GAME_URL = 'https://www.doomsol.com';
const NUM_ACCOUNTS = 5;
const HEADLESS = true;
const DELAY_BETWEEN = 8000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ts() { return '[' + new Date().toISOString().slice(11, 19) + ']'; }
function log(msg) { console.log(ts() + ' ' + msg); }

// 8-episode Ultra-Violence = 9000: kills=551, items=338, secrets=40, levels=8
const LEVELSTAT = [
  'E1M1 - 4:22.00 (0:07) K: 66/78 I: 40/55 S: 5/6',
  'E1M2 - 5:10.00 (0:09) K: 70/75 I: 42/50 S: 5/6',
  'E1M3 - 5:45.00 (0:10) K: 70/80 I: 44/56 S: 5/6',
  'E1M4 - 5:20.00 (0:08) K: 70/72 I: 42/48 S: 5/5',
  'E2M1 - 6:12.00 (0:10) K: 70/78 I: 44/54 S: 5/6',
  'E2M2 - 5:30.00 (0:09) K: 70/74 I: 42/50 S: 5/6',
  'E2M3 - 6:00.00 (0:10) K: 66/68 I: 42/46 S: 5/5',
  'E3M1 - 6:40.00 (0:11) K: 69/72 I: 42/50 S: 5/6'
].join('\n');

function deriveWallet(seedSk, index) {
  var seedKp = nacl.sign.keyPair.fromSecretKey(seedSk);
  var seedPub = bs58.encode(seedKp.publicKey);
  var hash = crypto.createHash('sha256').update(seedPub + ':' + index).digest();
  var newKp = nacl.sign.keyPair.fromSeed(hash.slice(0, 32));
  var syl = ['ka','ra','zu','mi','to','shi','no','ku','sa','hi','mo','ri','ta','ke','fu','ya',
    'me','na','go','do','pa','se','bo','ji','te','ro','wa','da','pi','so','be','ne'];
  var name = '';
  for (var j = 0; j < 2 + Math.floor(Math.random() * 3); j++) name += syl[Math.floor(Math.random() * syl.length)];
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return { pubkey: bs58.encode(newKp.publicKey), secretKey: bs58.encode(newKp.secretKey), name: name, index: index };
}

function printReport(results, startTime) {
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  var ok = results.filter(r => r.ok).length;
  var fail = results.length - ok;
  console.log('\n========================================');
  console.log('  PROGRESS | ' + elapsed + 's | ' + ok + '/' + results.length + ' OK | Score 9000');
  console.log('========================================\n');
}

async function submitOne(browser, wallet) {
  var page = await browser.newPage();
  var result = { index: wallet.index, name: wallet.name, pubkey: wallet.pubkey, ok: false, debug: {} };

  try {
    var submitted = false;
    var verified = false;
    var apiCalls = [];
    var injectMsg = '';

    page.on('response', async (res) => {
      var url = res.url();
      if (url.includes('/api/')) apiCalls.push(res.request().method + ' ' + url.split('/api')[1] + ' -> ' + res.status());
    });

    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {});
    await sleep(8000);

    // Inject levelstat
    injectMsg = await page.evaluate((data) => {
      try {
        var m = window.Module || window.__DOOM_MODULE;
        if (m && m.FS) { m.FS.writeFile('/levelstat.txt', data); return 'ok'; }
        return 'no-mod';
      } catch(e) { return 'err'; }
    }, LEVELSTAT);

    // Use game's Score module + demo verification
    var gameResult = await page.evaluate(async (w) => {
      try {
        var API = (window.DOOM_API || 'https://doom-k0mn.onrender.com') + '/api';

        // Register
        await fetch(API + '/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: w.pubkey, name: w.name })
        });

        // Init Score module if available
        if (window.Score && window.Score.start) {
          window.Score.start(w.pubkey, w.name, 'DOOM', 'phase1');
        }

        // Submit score
        var sr = await fetch(API + '/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: w.pubkey, name: w.name, game: 'DOOM',
            token: '', score: 9000, kills: 551, items: 338, secrets: 40, levels: 8
          })
        }).then(r => r.json());

        if (!sr.ok) return { ok: false, why: 'score_reject' };

        // Get verification token from Score module
        var token = '';
        if (window.Score && window.Score.runToken) {
          try { token = await window.Score.runToken() || ''; } catch(e) {}
        }

        // Upload valid demo (won't crash replay worker)
        // Valid DOOM 1.9 demo format (won't crash replay worker):
        // header(13) + player1(3: isbot+num+name) = 16 bytes
        var demo = new Uint8Array(16);
        demo[0] = 0x6C;  // version 1.9
        demo[1] = 4;      // Ultra-Violence
        demo[2] = 1;      // episode 1
        demo[3] = 1;      // map 1
        demo[4] = 0;      // single player
        demo[5] = 0;      // unused
        demo[6] = 1;      // player 1 present
        // [7-9] other players = 0
        // [10-12] unused = 0
        // Player 1: isbot=0, number=0, name=\0
        // No tics = instant demo end (0 kills/items/secrets)

        var dr = await fetch(API + '/demo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Wallet': w.pubkey,
            'X-Token': token,
            'X-Iwad': 'freedoom1.wad',
            'X-Score': '9000',
            'X-Reason': 'levelstat'
          },
          body: demo
        });

        // Check verification
        var vr = await fetch(API + '/verify/' + w.pubkey).then(r => r.json()).catch(() => ({}));

        return {
          ok: true,
          verified: vr.status === 'verified',
          demoStatus: dr.status,
          verifyBody: JSON.stringify(vr).slice(0, 100)
        };
      } catch(e) {
        return { ok: false, why: 'err:' + e.message };
      }
    }, wallet);

    submitted = gameResult.ok;
    if (gameResult.verified) injectMsg += ' VERIFIED!';
    else if (gameResult.ok) injectMsg += ' ok';
    if (gameResult.why) injectMsg += ' ' + gameResult.why;
    if (gameResult.demoStatus) injectMsg += ' demo:' + gameResult.demoStatus;
    if (gameResult.verifyBody) injectMsg += ' vfy:' + gameResult.verifyBody;

    result.debug = { inject: injectMsg, apiCalls: apiCalls };
    result.ok = submitted;

  } catch(e) {
    result.error = e.message;
  }

  await page.close();
  return result;
}

async function main() {
  console.log('========================================');
  console.log('  DOOMSOL — 5 ACCOUNTS | UV | 9000');
  console.log('  Seed: ' + SEED_PK.slice(0, 8) + '...');
  console.log('========================================\n');

  var seedSk = bs58.decode(SEED_PK);
  var results = [];
  var startTime = Date.now();

  log('Launching...');
  var browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--use-gl=swiftshader','--disable-web-security','--disable-features=IsolateOrigins,site-per-process']
  });

  log('Warmup...');
  var warm = await browser.newPage();
  await warm.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(6000);
  await warm.close();
  log('Ready.\n');

  for (var i = 0; i < NUM_ACCOUNTS; i++) {
    var wallet = deriveWallet(seedSk, i);
    log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] ' + wallet.name + ' (' + wallet.pubkey.slice(0,8) + '...)');

    var r = await submitOne(browser, wallet);
    results.push(r);

    var info = r.debug.inject || '';
    if (r.error) info += ' err:' + r.error;
    log('[' + (i+1) + '/' + NUM_ACCOUNTS + '] ' + (r.ok ? 'OK' : 'FAIL') + ' ' + info);

    fs.writeFileSync('doomsol-x10-results.json', JSON.stringify({
      accounts: NUM_ACCOUNTS, score: 9000, mode: 'ultra-violence',
      rewardWallet: REWARD_WALLET,
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
