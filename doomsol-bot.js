// DoomSol Gameplay Bot — actually plays DOOM
// Uses cheats + automation to clear levels and submit verified scores
// npm install puppeteer tweetnacl bs58
// node doomsol-bot.js

const puppeteer = require('puppeteer');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const crypto = require('crypto');
const fs = require('fs');

// === CONFIG ===
const SEED_PK = 'SEED_PK_REMOVED';
const REWARD_WALLET = 'GW6PN47T4LJASKLHeAuVHhic9JFdyHd4hJsFhDqBukcS';
const GAME_URL = 'https://www.doomsol.com';
const NUM_ACCOUNTS = 5;
const TARGET_LEVELS = 8;    // 8 levels to get ~8000-9000 score
const DIFFICULTY = 4;       // Ultra-Violence
const HEADLESS = false;     // need to see the game to play it

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ts() { return '[' + new Date().toISOString().slice(11, 19) + ']'; }
function log(msg) { console.log(ts() + ' ' + msg); }

// === WALLET ===
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

// === KEYBOARD HELPERS ===
async function pressKey(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms || 100);
  await page.keyboard.up(key);
}

async function holdKey(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

async function typeText(page, text) {
  for (var c of text) {
    await pressKey(page, c, 60);
    await sleep(40);
  }
}

// === CHEAT CODES ===
async function enableCheats(page) {
  log('  Enabling cheats...');
  // IDDQD = god mode
  await typeText(page, 'iddqd');
  await sleep(300);
  // IDKFA = all weapons + keys + ammo
  await typeText(page, 'idkfa');
  await sleep(300);
  // IDCLIP = noclip (walk through walls)
  await typeText(page, 'idclip');
  await sleep(300);
  // IDDT = full automap (press twice for items shown)
  await typeText(page, 'iddt');
  await sleep(200);
  await typeText(page, 'iddt');
  await sleep(300);
  log('  Cheats enabled: god + all keys + noclip + full map');
}

// === GAMEPLAY: drunken walk + shoot ===
// Simple strategy: move forward, shoot constantly, strafe to avoid walls
async function playLevel(page, levelNum) {
  log('  Level ' + levelNum + ': playing...');
  var startTime = Date.now();
  var timeout = 120000; // 2 min max per level

  // Movement pattern: forward + slight random strafe + constant fire
  // Hold W (forward) continuously
  await page.keyboard.down('w');

  while (Date.now() - startTime < timeout) {
    // Fire constantly (Ctrl)
    await page.keyboard.down('Control');
    await sleep(200);
    await page.keyboard.up('Control');

    // Random strafe to explore
    var r = Math.random();
    if (r < 0.3) {
      await holdKey(page, 'a', 300 + Math.floor(Math.random() * 500));
    } else if (r < 0.6) {
      await holdKey(page, 'd', 300 + Math.floor(Math.random() * 500));
    }

    // Occasionally turn
    if (Math.random() < 0.2) {
      await page.mouse.move(
        400 + Math.floor(Math.random() * 400),
        300 + Math.floor(Math.random() * 200)
      );
    }

    // Press space occasionally (open doors/switches)
    if (Math.random() < 0.1) {
      await pressKey(page, 'Space', 100);
    }

    // Check if level complete (watch for levelstat update)
    var done = await page.evaluate(() => {
      try {
        var m = window.Module;
        if (m && m.FS) {
          var data = m.FS.readFile('/levelstat.txt', { encoding: 'utf8' });
          return data.includes('E1M' + (window.__currentLevel || 1));
        }
      } catch(e) {}
      return false;
    });

    if (done) break;
  }

  await page.keyboard.up('w');
  log('  Level ' + levelNum + ': completed or timeout');
}

// === SUBMIT ONE ACCOUNT ===
async function submitAccount(browser, wallet) {
  var page = await browser.newPage();
  var result = { index: wallet.index, name: wallet.name, pubkey: wallet.pubkey, scores: [] };

  try {
    // Track score submissions
    page.on('response', async (res) => {
      var url = res.url();
      if (url.includes('/api/score') && res.request().method() === 'POST') {
        try {
          var body = await res.json();
          if (body.ok) {
            result.scores.push({ round: body.roundIndex, score: 'submitted' });
            log('  SCORE submitted! round ' + body.roundIndex);
          }
        } catch(e) {}
      }
    });

    // Load game
    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3000);

    // === ENTER NAME ===
    log('  Entering name: ' + wallet.name);
    var nameInput = await page.$('#player');
    if (nameInput) {
      await nameInput.click();
      await sleep(300);
      // Clear and type
      await page.evaluate(() => { document.getElementById('player').value = ''; });
      await nameInput.type(wallet.name, { delay: 50 });
      await sleep(300);
    }

    // Enter wallet
    var walletInput = await page.$('#wallet');
    if (walletInput) {
      await walletInput.click();
      await sleep(200);
      await walletInput.type(wallet.pubkey, { delay: 30 });
      await sleep(300);
    }

    // Click enter button
    var enterBtn = await page.$('#enter-btn');
    if (enterBtn) {
      await enterBtn.click();
      await sleep(2000);
    }
    log('  Identity set');

    // === SELECT DIFFICULTY: Ultra-Violence ===
    log('  Selecting Ultra-Violence...');
    await page.evaluate((skill) => {
      var btns = document.querySelectorAll('#skill-seg button');
      if (btns[skill - 1]) btns[skill - 1].click();
    }, DIFFICULTY);
    await sleep(500);

    // === LAUNCH GAME ===
    log('  Launching game...');
    var launchBtn = await page.$('#launch');
    if (launchBtn) {
      // Make sure it's enabled
      await page.evaluate(() => {
        var btn = document.getElementById('launch');
        if (btn) { btn.disabled = false; btn.textContent = 'Launch'; btn.click(); }
      });
      await sleep(500);
    }

    // Wait for game canvas
    await page.waitForSelector('#game.show, #game[class*="show"], canvas', { timeout: 30000 }).catch(() => {});
    await sleep(10000); // wait for WASM to fully boot

    // Lock mouse to game
    var canvas = await page.$('canvas');
    if (canvas) {
      await canvas.click();
      await sleep(1000);
    }

    // === ENABLE CHEATS ===
    await enableCheats(page);

    // === PLAY LEVELS ===
    for (var level = 1; level <= TARGET_LEVELS; level++) {
      await page.evaluate((lvl) => { window.__currentLevel = lvl; }, level);
      await playLevel(page, level);

      // Check if game is still running
      var alive = await page.evaluate(() => {
        return document.querySelector('#game.show, #game[class*="show"]') !== null;
      });
      if (!alive) {
        log('  Game ended at level ' + level);
        break;
      }
    }

    // === COLLECT RESULTS ===
    var finalScore = await page.evaluate(() => {
      var el = document.querySelector('#hud-score .v, [id*="score"] .v');
      return el ? parseInt(el.textContent) || 0 : 0;
    });

    result.finalScore = finalScore;
    log('  Done. Final score: ' + (finalScore || 'unknown'));

  } catch(e) {
    result.error = e.message;
    log('  ERROR: ' + e.message);
  }

  await page.close();
  return result;
}

// === MAIN ===
async function main() {
  console.log('========================================');
  console.log('  DOOMSOL GAMEPLAY BOT — 5 ACCOUNTS');
  console.log('  Difficulty: Ultra-Violence');
  console.log('  Target: ' + TARGET_LEVELS + ' levels | 8000-9000 score');
  console.log('========================================\n');

  var seedSk = bs58.decode(SEED_PK);
  var results = [];
  var startTime = Date.now();

  log('Launching browser...');
  var browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-gpu', '--use-gl=swiftshader',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  for (var i = 0; i < NUM_ACCOUNTS; i++) {
    var wallet = deriveWallet(seedSk, i);
    log('=== Account ' + (i+1) + '/' + NUM_ACCOUNTS + ': ' + wallet.name + ' ===');

    var r = await submitAccount(browser, wallet);
    results.push(r);

    var status = r.scores.length > 0 ? r.scores.length + ' scores' : 'no scores';
    if (r.error) status += ' err:' + r.error;
    log((i+1) + '/' + NUM_ACCOUNTS + ' done: ' + status + ' score:' + (r.finalScore || '?'));

    fs.writeFileSync('doomsol-bot-results.json', JSON.stringify({
      accounts: NUM_ACCOUNTS, difficulty: 'ultra-violence',
      rewardWallet: REWARD_WALLET,
      completed: i + 1,
      results: results
    }, null, 2));

    await sleep(3000);
  }

  await browser.close();
  log('ALL DONE.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
