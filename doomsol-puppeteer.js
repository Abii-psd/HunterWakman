// DoomSol Puppeteer Farmer — WASM Levelstat Injection
// Requires: npm install puppeteer tweetnacl bs58 @solana/web3.js
// Usage: node doomsol-puppeteer.js
//
// Uses real browser + WASM filesystem injection to submit
// verified scores that appear on the leaderboard.

const puppeteer = require('puppeteer');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const crypto = require('crypto');
const fs = require('fs');

// === CONFIG ===
const SEED_PK = 'OLD_SEED_PK_REMOVED';
const REWARD_WALLET = 'GW6PN47T4LJASKLHeAuVHhic9JFdyHd4hJsFhDqBukcS';
const GAME_URL = 'https://www.doomsol.com';
const ACCOUNT_INDEX = 0; // change per account
const HEADLESS = true;   // set false to see browser

// === LEVELSTAT GENERATOR ===
// Generates realistic DOOM level completion data
// Score per level: 10*kills + 5*items + 25*secrets + 100
function generateLevelstat(targetScore) {
  // Single level — split target among kills/items/secrets
  var kills = Math.floor(targetScore * 0.40 / 10);   // 40% from kills
  var items = Math.floor(targetScore * 0.30 / 5);    // 30% from items
  var secrets = Math.floor(targetScore * 0.20 / 25);  // 20% from secrets
  // Remaining ~10% from base 100

  var minutes = 1 + Math.floor(Math.random() * 3);
  var seconds = Math.floor(Math.random() * 60);
  var timeStr = minutes + ':' + String(seconds).padStart(2, '0') + '.00';
  var penaltyStr = '0:' + String(Math.floor(seconds * 0.7)).padStart(2, '0');

  // Plausible max values per level
  var maxKills = kills + Math.floor(Math.random() * 20);
  var maxItems = items + Math.floor(Math.random() * 15);
  var maxSecrets = secrets + Math.floor(Math.random() * 3) + 1;

  return 'E1M1 - ' + timeStr + ' (' + penaltyStr + ') K: ' + kills + '/' + maxKills +
         ' I: ' + items + '/' + maxItems + ' S: ' + secrets + '/' + maxSecrets;
}

// === WALLET DERIVATION ===
function deriveWallet(seedSk, index) {
  var seedKp = nacl.sign.keyPair.fromSecretKey(seedSk);
  var seedPub = bs58.encode(seedKp.publicKey);
  var hash = crypto.createHash('sha256').update(seedPub + ':' + index).digest();
  var newKp = nacl.sign.keyPair.fromSeed(hash.slice(0, 32));
  return {
    pubkey: bs58.encode(newKp.publicKey),
    secretKey: bs58.encode(newKp.secretKey),
    name: 'Player' + index,
    index: index
  };
}

// === MAIN ===
async function main() {
  console.log('=== DOOMSOL PUPPETEER FARMER ===');
  console.log('');

  // Derive wallet
  var seedSk = bs58.decode(SEED_PK);
  var wallet = deriveWallet(seedSk, ACCOUNT_INDEX);
  console.log('Wallet: ' + wallet.pubkey);
  console.log('Name: ' + wallet.name);
  console.log('');

  // Generate levelstat for realistic score (~300)
  var targetScore = 280 + Math.floor(Math.random() * 80); // 280-360
  var levelstat = generateLevelstat(targetScore);
  console.log('Target score: ~' + targetScore);
  console.log('Levelstat: ' + levelstat);
  console.log('');

  // Launch browser
  console.log('Launching browser...');
  var browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--use-gl=swiftshader',     // software WebGL for DOOM
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  var page = await browser.newPage();

  // Intercept console logs from the page
  page.on('console', msg => {
    if (msg.type() === 'log') console.log('  [PAGE] ' + msg.text());
  });

  // Track score submission API calls
  var scoreSubmitted = false;
  var submitResult = null;
  page.on('response', async (response) => {
    var url = response.url();
    if (url.includes('/api/score') && response.request().method() === 'POST') {
      try {
        submitResult = await response.json();
        scoreSubmitted = true;
        console.log('  [API] Score submit response: ' + JSON.stringify(submitResult));
      } catch(e) {}
    }
  });

  try {
    // Navigate to game
    console.log('Loading ' + GAME_URL + '...');
    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded');

    // Wait for the game canvas / WASM to initialize
    // DOOM runs in a canvas element
    await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {
      console.log('No canvas found — trying iframe...');
    });

    // Give WASM time to boot
    console.log('Waiting for game to initialize...');
    await new Promise(r => setTimeout(r, 5000));

    // Check if Module.FS is accessible
    var fsReady = await page.evaluate(() => {
      return typeof window.Module !== 'undefined' &&
             typeof window.Module.FS !== 'undefined';
    });
    console.log('Module.FS ready: ' + fsReady);

    if (!fsReady) {
      // Try finding Module on window or in iframes
      console.log('Searching for Module in frames...');
      var frames = page.frames();
      for (var f of frames) {
        try {
          var hasFS = await f.evaluate(() => {
            return typeof window.Module !== 'undefined' &&
                   typeof window.Module.FS !== 'undefined';
          });
          if (hasFS) {
            console.log('Found Module.FS in frame: ' + f.url());
            page = f; // switch to game frame
            fsReady = true;
            break;
          }
        } catch(e) {}
      }
    }

    if (!fsReady) {
      // Last resort — inject a hook to catch when Module initializes
      console.log('Injecting Module hook...');
      await page.evaluate(() => {
        var origDefineProperty = Object.defineProperty;
        Object.defineProperty = function(obj, prop, desc) {
          origDefineProperty.call(Object, obj, prop, desc);
          if (prop === 'Module' && desc.value && desc.value.FS) {
            window.__DOOM_MODULE = desc.value;
          }
        };
      });
      // Reload to catch the Module definition
      await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 8000));

      fsReady = await page.evaluate(() => {
        return !!(window.__DOOM_MODULE && window.__DOOM_MODULE.FS);
      });
      console.log('Module.FS after hook: ' + fsReady);
    }

    if (!fsReady) {
      console.log('WARNING: Could not access Module.FS — trying direct inject anyway');
    }

    // Inject levelstat into WASM filesystem
    console.log('Injecting levelstat...');
    var injectResult = await page.evaluate((levelstatData) => {
      try {
        var mod = window.Module || window.__DOOM_MODULE;
        if (mod && mod.FS) {
          mod.FS.writeFile('/levelstat.txt', levelstatData);
          return 'injected via Module.FS';
        }
        // Fallback: try IDBFS or other storage
        if (window.indexedDB) {
          return 'Module.FS not found — trying IDBFS';
        }
        return 'no FS access';
      } catch(e) {
        return 'error: ' + e.message;
      }
    }, levelstat);
    console.log('Inject result: ' + injectResult);

    // Wait for score to appear in UI
    console.log('Waiting for score display...');
    await new Promise(r => setTimeout(r, 3000));

    // Try to find and interact with game UI
    // Look for start/play button or score display
    var uiInfo = await page.evaluate(() => {
      var info = {};

      // Check for common UI elements
      var buttons = document.querySelectorAll('button, [role="button"], .btn, .button');
      info.buttons = [];
      buttons.forEach(b => {
        var text = (b.textContent || '').trim().slice(0, 40);
        if (text) info.buttons.push(text);
      });

      // Check for score display
      var scoreEls = document.querySelectorAll('[class*="score"], [id*="score"], [class*="points"]');
      info.scores = [];
      scoreEls.forEach(s => {
        info.scores.push((s.textContent || '').trim().slice(0, 40));
      });

      // Check page title
      info.title = document.title;

      return info;
    });
    console.log('Page title: ' + uiInfo.title);
    console.log('Buttons found: ' + JSON.stringify(uiInfo.buttons.slice(0, 10)));
    console.log('Score elements: ' + JSON.stringify(uiInfo.scores.slice(0, 5)));

    // Try clicking "New Game" or "Play" button
    if (!scoreSubmitted) {
      for (var btnText of uiInfo.buttons) {
        if (/play|start|new game|begin|enter/i.test(btnText)) {
          console.log('Clicking: ' + btnText);
          try {
            await page.evaluate((text) => {
              var btns = document.querySelectorAll('button, [role="button"]');
              for (var b of btns) {
                if (b.textContent.trim() === text) { b.click(); break; }
              }
            }, btnText);
          } catch(e) {}
          break;
        }
      }
    }

    // Wait for score submission
    console.log('Waiting for score submission...');
    await new Promise(r => setTimeout(r, 10000));

    if (scoreSubmitted) {
      console.log('Score submitted successfully!');
      console.log(JSON.stringify(submitResult, null, 2));
    } else {
      console.log('Score not auto-submitted. Trying manual trigger...');

      // Try accessing game's submit function
      await page.evaluate(() => {
        // Try common patterns for triggering score save
        if (window.dispatchEvent) {
          window.dispatchEvent(new Event('beforeunload'));
        }
        // Try calling game submit if exposed
        if (window.submitScore) window.submitScore();
        if (window.game && window.game.submitScore) window.game.submitScore();
      });

      await new Promise(r => setTimeout(r, 5000));
      console.log('Score submitted after manual trigger: ' + scoreSubmitted);
    }

    // Take screenshot for debugging
    await page.screenshot({ path: 'doomsol-result.png' });
    console.log('Screenshot saved: doomsol-result.png');

  } catch(e) {
    console.error('Error: ' + e.message);
    await page.screenshot({ path: 'doomsol-error.png' });
    console.log('Error screenshot saved: doomsol-error.png');
  }

  // Check leaderboard
  console.log('');
  console.log('=== CHECKING LEADERBOARD ===');
  var lbPage = await browser.newPage();
  await lbPage.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  var lbData = await lbPage.evaluate(() => {
    var rows = document.querySelectorAll('[class*="leaderboard"] tr, [class*="leaderboard"] li, [class*="score"] tr');
    var data = [];
    rows.forEach(r => data.push((r.textContent || '').trim().slice(0, 80)));
    return data.slice(0, 15);
  });
  console.log('Leaderboard:');
  lbData.forEach(row => console.log('  ' + row));

  await lbPage.close();
  await browser.close();
  console.log('');
  console.log('Done.');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
