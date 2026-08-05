// DoomSol Multi-Account Farmer v3
// Compatible with Node.js 16+
// Usage: node doomsol-farmer-v3.js
//
// v3 changes:
//   - Submit at 2s before payout (was 5s)
//   - Track rewards per wallet + total SOL earned
//   - Reward report saved to rewards.json
//   - Auto-transfer SOL to reward wallet

const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');

// === CONFIG ===
const SEED_PK = 'OLD_SEED_PK_REMOVED';
const REWARD_WALLET = 'GW6PN47T4LJASKLHeAuVHhic9JFdyHd4hJsFhDqBukcS';
const API_HOST = 'doom-k0mn.onrender.com';
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const NUM_ACCOUNTS = 1000;
const PER_ROUND = 100;
const SCORE = 2500;
const KILLS = 240;
const LEVELS = 1;
const SUBMIT_BEFORE_SEC = 2; // submit 2 seconds before payout

// === STATE ===
let rewards = loadRewards(); // { wallet: { pubkey, name, rounds: [], totalSOL } }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + msg); }

function loadRewards() {
  try { return JSON.parse(fs.readFileSync('rewards.json', 'utf8')); }
  catch { return {}; }
}

function saveRewards() {
  fs.writeFileSync('rewards.json', JSON.stringify(rewards, null, 2));
}

function rewardReport() {
  var entries = Object.values(rewards).filter(r => r.totalSOL > 0);
  entries.sort((a, b) => b.totalSOL - a.totalSOL);

  var totalSOL = entries.reduce((s, r) => s + r.totalSOL, 0);

  log('');
  log('=== REWARD REPORT ===');
  log('Total wallets with rewards: ' + entries.length);
  log('Total SOL earned: ' + totalSOL.toFixed(6) + ' SOL');
  log('');

  if (entries.length > 0) {
    console.log('  WALLET                                    NAME           SOL      ROUNDS');
    console.log('  ' + '-'.repeat(75));
    for (var i = 0; i < Math.min(entries.length, 20); i++) {
      var r = entries[i];
      console.log('  ' + r.pubkey.slice(0, 10) + '...' + r.pubkey.slice(-6).padEnd(6) +
        '  ' + r.name.padEnd(12) +
        '  ' + r.totalSOL.toFixed(6).padStart(10) +
        '  ' + String(r.rounds.length).padStart(6));
    }
    if (entries.length > 20) console.log('  ... and ' + (entries.length - 20) + ' more');
    console.log('');
  }
}

// === SOL TRANSFER ===
async function transferAllSOL(conn, fromWallet) {
  try {
    var fromKp = Keypair.fromSecretKey(bs58.decode(fromWallet.secretKey));
    var fromPubkey = new PublicKey(fromWallet.pubkey);
    var toPubkey = new PublicKey(REWARD_WALLET);

    var balance = await conn.getBalance(fromPubkey);
    if (balance < 5000) return 0; // too small, skip (would fail on rent)

    var tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromPubkey,
        toPubkey: toPubkey,
        lamports: balance - 5000 // leave 5000 for rent
      })
    );

    var sig = await sendAndConfirmTransaction(conn, tx, [fromKp], { commitment: 'confirmed' });
    return balance / LAMPORTS_PER_SOL;
  } catch (e) {
    // likely "account not found" (no SOL ever received) — skip silently
    return 0;
  }
}

// === HTTP HELPERS ===
function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    var data = JSON.stringify(body);
    var opts = {
      hostname: API_HOST,
      path: '/api' + path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000
    };
    var req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function apiGet(path) {
  return new Promise((resolve, reject) => {
    var opts = {
      hostname: API_HOST,
      path: '/api' + path,
      method: 'GET',
      timeout: 10000
    };
    var req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function deriveWallets(seedSk, n) {
  var wallets = [];
  var seedKp = nacl.sign.keyPair.fromSecretKey(seedSk);
  var seedPub = bs58.encode(seedKp.publicKey);

  for (var i = 0; i < n; i++) {
    var hash = crypto.createHash('sha256').update(seedPub + ':' + i).digest();
    var newKp = nacl.sign.keyPair.fromSeed(hash.slice(0, 32));
    wallets.push({
      pubkey: bs58.encode(newKp.publicKey),
      secretKey: bs58.encode(newKp.secretKey),
      name: generateName(i),
      index: i
    });
  }
  return wallets;
}

function generateName(i) {
  var prefixes = ['Alpha','Bravo','Charlie','Delta','Echo','Fox','Ghost','Hawk','Ice','Jade',
    'Kilo','Lima','Mike','Nova','Oscar','Papa','Queen','Romeo','Sierra','Tango',
    'Ultra','Victor','Whisky','Xray','Yankee','Zulu','Storm','Blade','Fang','Wolf'];
  return prefixes[i % prefixes.length] + (Math.floor(i / prefixes.length) || '');
}

async function registerWallet(wallet) {
  return apiPost('/register', { wallet: wallet.pubkey, name: wallet.name });
}

async function submitScore(wallet) {
  return apiPost('/score', {
    wallet: wallet.pubkey,
    name: wallet.name,
    game: 'DOOM',
    token: '',
    score: SCORE,
    kills: KILLS,
    levels: LEVELS
  });
}

async function getStatus() {
  return apiGet('/status');
}

async function getLeaderboard() {
  try { return await apiGet('/leaderboard'); }
  catch { return null; }
}

// === CHECK REWARDS AFTER ROUND ===
async function checkAndTransferRewards(conn, wallets) {
  log('  Checking balances & transferring...');

  var earnedThisRound = 0;
  var winnersThisRound = [];

  for (var i = 0; i < PER_ROUND; i++) {
    var w = wallets[i];
    try {
      var balance = await conn.getBalance(new PublicKey(w.pubkey));
      if (balance > 10000) { // has more than dust
        var sol = balance / LAMPORTS_PER_SOL;

        if (!rewards[w.pubkey]) {
          rewards[w.pubkey] = { pubkey: w.pubkey, name: w.name, rounds: [], totalSOL: 0 };
        }

        var prev = rewards[w.pubkey].totalSOL;
        if (sol > prev) {
          var earned = sol - prev;
          rewards[w.pubkey].rounds.push({ round: '?', earned: earned, time: new Date().toISOString() });
          rewards[w.pubkey].totalSOL = sol;
          earnedThisRound += earned;
          winnersThisRound.push({ wallet: w, earned: earned });

          log('  WIN: ' + w.name + ' (' + w.pubkey.slice(0, 8) + '...) +' + earned.toFixed(6) + ' SOL');

          // Transfer to reward wallet
          try {
            var transferred = await transferAllSOL(conn, w);
            if (transferred > 0) {
              log('  TRANSFER: ' + transferred.toFixed(6) + ' SOL -> ' + REWARD_WALLET.slice(0, 6) + '...');
            }
          } catch (e) {
            log('  Transfer failed for ' + w.name + ': ' + e.message);
          }
        }
      }
    } catch (e) {
      // wallet likely has no SOL, skip
    }
    await sleep(50);
  }

  if (earnedThisRound > 0) {
    log('  Round total earned: ' + earnedThisRound.toFixed(6) + ' SOL (' + winnersThisRound.length + ' wallets)');
    saveRewards();
  } else {
    log('  No rewards this round');
  }

  return earnedThisRound;
}

// === MAIN ===
async function main() {
  log('=== DOOMSOL MULTI FARMER v3 ===');
  log('Seed PK: ' + SEED_PK.slice(0, 8) + '...');
  log('Accounts: ' + NUM_ACCOUNTS + ' | Per round: ' + PER_ROUND);
  log('Reward wallet: ' + REWARD_WALLET);
  log('Score: ' + SCORE + ' (' + KILLS + ' kills, ' + LEVELS + ' levels)');
  log('Submit: ' + SUBMIT_BEFORE_SEC + 's before payout');
  log('RPC: ' + SOLANA_RPC);
  log('');

  // Connect to Solana
  var conn = new Connection(SOLANA_RPC, 'confirmed');

  // Derive wallets
  var seedSk = bs58.decode(SEED_PK);
  var wallets = deriveWallets(seedSk, NUM_ACCOUNTS);
  log('Generated ' + wallets.length + ' wallets');
  log('Sample: ' + wallets[0].pubkey.slice(0, 8) + '... "' + wallets[0].name + '"');

  // Register all wallets
  log('');
  log('=== REGISTERING ===');
  var registered = 0;
  for (var wi = 0; wi < wallets.length; wi++) {
    var w = wallets[wi];
    try {
      var r = await registerWallet(w);
      if (r && r.error !== 'banned') registered++;
    } catch(e) {}
    if (w.index % 100 === 0) log('  ' + w.index + '/' + NUM_ACCOUNTS + ' (' + registered + ' ok)');
    await sleep(300);
  }
  log('Registered: ' + registered + '/' + NUM_ACCOUNTS);

  // Main loop
  log('');
  log('=== FARMING LOOP ===');
  var roundIdx = 0;
  var submittedThisRound = false;
  var grandTotalSOL = 0;

  while (true) {
    var status;
    try { status = await getStatus(); } catch(e) { await sleep(5000); continue; }

    var round = status.round;
    var endsAt = new Date(round.endsAt).getTime();
    var now = Date.now();
    var msLeft = endsAt - now;

    if (round.index !== roundIdx) {
      roundIdx = round.index;
      submittedThisRound = false;
      log('');
      log('Round ' + roundIdx + ' | Pool: ' + (status.estimatedPoolLamports/LAMPORTS_PER_SOL).toFixed(4) + ' SOL | Players: ' + status.playersThisRound);
    }

    // Submit at SUBMIT_BEFORE_SEC seconds before payout (v3: 2s instead of 5s)
    var submitWindow = (SUBMIT_BEFORE_SEC + 1) * 1000; // 1s buffer
    if (msLeft <= submitWindow && msLeft > 0 && !submittedThisRound) {
      log('  Submitting ' + PER_ROUND + ' scores (' + (msLeft/1000).toFixed(1) + 's before payout)...');
      var batch = wallets.slice(0, PER_ROUND);
      var submitted = 0;
      for (var bi = 0; bi < batch.length; bi++) {
        try {
          var r = await submitScore(batch[bi]);
          if (r && r.ok) submitted++;
        } catch(e) {}
        await sleep(20); // tighter spacing for 2s window
      }
      log('  Done: ' + submitted + '/' + PER_ROUND);
      submittedThisRound = true;

      // Wait for round to end + payout
      await sleep(msLeft + 3000); // wait past payout

      // Check rewards & transfer
      grandTotalSOL += await checkAndTransferRewards(conn, wallets);

      // Show report every 10 rounds
      if (roundIdx % 10 === 0) {
        rewardReport();
        log('Grand total transferred: ' + grandTotalSOL.toFixed(6) + ' SOL');
      }

    } else if (msLeft <= 0) {
      await sleep(5000);
    } else {
      // Wait until just before submit window
      var waitMs = msLeft - submitWindow - 2000;
      if (waitMs > 60000) waitMs = 60000;
      if (waitMs < 5000) waitMs = 5000;
      await sleep(waitMs);
    }
  }
}

main().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
