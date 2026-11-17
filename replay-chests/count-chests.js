#!/usr/bin/env node
/*
 * Spocita z Fortnite replayu, kolik truhel (a beden s municí) otevrel kazdy hrac.
 *
 * Jak to funguje: v replayi ma kazda truhla pole `SearchingPawn` (postava, ktera ji
 * prave otevira) a `bAlreadySearched` (uz je otevrena). Kdyz se truhla prepne na
 * otevrenou, pripiseme ji hraci, jehoz postava ji otevirala.
 *
 * Pouziti:
 *   node count-chests.js                              # hleda Plocha\data, pak Demos
 *   node count-chests.js "C:\cesta\k\replayum"
 *   node count-chests.js a.replay b.replay ...        # jen vybrane soubory
 *   (nebo oznac replaye v Pruzkumniku a pretahni je mysi na spustit.bat)
 *   node count-chests.js --do "2026-11-17 13:50"      # jen truhly otevrene pred timto casem
 *   node count-chests.js --od 2026-11-01 --do "2026-11-17 13:50"
 *   node count-chests.js --ja MojeJmeno               # kdyz se "ty" neurci samo
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const parseReplay = require('fortnite-replay-parser');
const defaultHandlers = require('fortnite-replay-parser/export/handleEventEmitter');
const basePlayerState = require('fortnite-replay-parser/NetFieldExports/FortPlayerState.json');

// ------------------------------------------------------------------ argumenty

function parseArgs(argv) {
  const opts = { paths: [], od: null, do: null, ja: null, detail: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--od') opts.od = parseDate(argv[++i], '--od');
    else if (a === '--do') opts.do = parseDate(argv[++i], '--do');
    else if (a === '--ja') opts.ja = argv[++i];
    else if (a === '--detail') opts.detail = true;
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    } else opts.paths.push(a);
  }
  return opts;
}

function parseDate(s, flag) {
  if (!s) fail(`${flag} potrebuje datum, napr. "2026-11-17 13:50"`);
  const d = new Date(s.trim().replace(' ', 'T')); // bez zony = mistni cas
  if (isNaN(d)) fail(`Nerozumim datu "${s}". Pouzij format "2026-11-17 13:50".`);
  return d;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ------------------------------------------------------------------ hledani replayu

function candidateDirs() {
  const home = os.homedir();
  const od = process.env.OneDrive;
  const dirs = [];
  for (const base of [home, od, od && path.dirname(od), path.join(home, 'OneDrive')]) {
    if (!base) continue;
    for (const desk of ['Desktop', 'Plocha']) {
      dirs.push(path.join(base, desk, 'data'));
      dirs.push(path.join(base, 'OneDrive', desk, 'data'));
    }
  }
  if (process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, 'FortniteGame', 'Saved', 'Demos'));
  }
  return [...new Set(dirs)];
}

function findReplays(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.replay')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// ------------------------------------------------------------------ export hracu s tymem

// Ke standardnim polim hrace pridame TeamIndex / SquadId, abychom poznali spoluhrace.
const playerStateExport = JSON.parse(JSON.stringify(basePlayerState));
for (const name of ['TeamIndex', 'SquadId']) {
  playerStateExport.properties[name] = { name, type: 'DebugObject', parseType: 'readClass' };
}

function debugObjectToUInt(obj) {
  if (!obj || !obj.data || !obj.size) return null;
  let v = 0;
  for (let i = 0; i < obj.data.length && i < 4; i++) v += obj.data[i] * 2 ** (8 * i);
  return obj.size < 32 ? v % 2 ** obj.size : v;
}

// ------------------------------------------------------------------ parsovani jednoho replaye

const KNOWN_CHEST_PATHS = [
  'Tiered_Chest_Athena.Tiered_Chest_Athena_C',
  'Tiered_Ammo_Athena.Tiered_Ammo_Athena_C',
];

async function analyzeReplay(file) {
  const chestState = {}; // staticActorId -> { counted, searcher }
  const opens = []; // { player, kind, timeSeconds }
  let alreadyOpenUnknown = 0;
  let gd = null;

  const resolvePawn = (guid, globalData, states) => {
    const ch = globalData.actorToChannel[guid];
    if (ch === undefined) return null;
    const stateCh = states.pawnChannelToStateChannel[ch];
    if (stateCh === undefined) return null;
    return states.players[stateCh] || null;
  };

  const onChest = ({ data, staticActorId, globalData, states, timeSeconds, changedProperties }) => {
    gd = globalData;
    const id = staticActorId || `ch${Math.random()}`;
    const kind = /ammo/i.test(id) ? 'ammo' : 'chest';
    const st = chestState[id] || (chestState[id] = { counted: false, searcher: null, seen: false });

    if (changedProperties.includes('SearchingPawn') && data.SearchingPawn) {
      const who = resolvePawn(data.SearchingPawn, globalData, states);
      if (who) st.searcher = who;
    }

    if (changedProperties.includes('bAlreadySearched') && data.bAlreadySearched && !st.counted) {
      st.counted = true;
      if (st.searcher) opens.push({ player: st.searcher, kind, timeSeconds });
      else if (!st.seen) alreadyOpenUnknown++; // uz byla otevrena, kdyz se k ni replay dostal
      else opens.push({ player: null, kind, timeSeconds });
    }
    st.seen = true;
  };

  const handleEventEmitter = (emitters) => {
    defaultHandlers(emitters);
    emitters.propertyExportEmitter.on('Chests', onChest);
  };

  const buf = fs.readFileSync(file);
  const result = await parseReplay(buf, {
    parseLevel: 2,
    parseEvents: false,
    customNetFieldExports: [playerStateExport],
    handleEventEmitter,
  });

  // Sebekontrola: obsahuje replay i jine typy truhel, ktere neumime pocitat?
  const otherChestTypes = [];
  if (gd) {
    for (const g of Object.values(gd.netGuidCache.NetFieldExportGroupMap)) {
      const p = g && g.pathName;
      if (p && /chest|ammo/i.test(p) && !/ClassNetCache/i.test(p)
          && !KNOWN_CHEST_PATHS.some((k) => p.endsWith(k))) {
        otherChestTypes.push(p);
      }
    }
  }

  const players = (result.gameData && result.gameData.players) || [];
  return {
    file,
    start: result.info && result.info.Timestamp ? new Date(result.info.Timestamp) : null,
    players,
    opens,
    alreadyOpenUnknown,
    otherChestTypes,
  };
}

// ------------------------------------------------------------------ main

const playerKey = (p) => p && (p.UniqueId || p.UniqueID || p.PlayerNamePrivate || `id${p.PlayerID}`);
const playerName = (p) => (p && (p.PlayerNamePrivate || p.UniqueId)) || '(neznamy)';
const teamOf = (p) => (p ? debugObjectToUInt(p.TeamIndex) : null);
const fmt = (d) => (d ? d.toLocaleString('cs-CZ') : '?');

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let paths = opts.paths;
  if (!paths.length) {
    const dir = candidateDirs().find((d) => fs.existsSync(d) && findReplays(d).length);
    if (!dir) fail('Nenasel jsem zadne .replay soubory. Zadej cestu: node count-chests.js "C:\\cesta\\ke\\slozce"');
    paths = [dir];
  }
  const files = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) fail(`${p} neexistuje.`);
    if (fs.statSync(p).isDirectory()) files.push(...findReplays(p));
    else if (p.toLowerCase().endsWith('.replay')) files.push(p);
  }
  files.sort((x, y) => path.basename(x).localeCompare(path.basename(y)));
  if (!files.length) fail(`V ${paths.join(', ')} nejsou zadne .replay soubory.`);
  console.log(`Replayu: ${files.length}  (${path.basename(files[0])} ... ${path.basename(files[files.length - 1])})`);
  if (opts.od) console.log(`Od: ${fmt(opts.od)}`);
  if (opts.do) console.log(`Do: ${fmt(opts.do)}`);
  console.log('');

  const analyses = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    process.stdout.write(`[${i + 1}/${files.length}] ${path.basename(f)} ... `);
    const t0 = Date.now();
    try {
      const a = await analyzeReplay(f);
      analyses.push(a);
      console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)} s, zacatek ${fmt(a.start)})`);
    } catch (e) {
      console.log(`CHYBA: ${e.message}`);
    }
  }
  if (!analyses.length) fail('\nZadny replay se nepodarilo precist.');

  // Kdo jsem "ja": zadane jmeno, jinak hrac, ktery je v nejvic replayich.
  const appear = new Map();
  for (const a of analyses) {
    for (const p of new Set(a.players.map(playerKey))) {
      appear.set(p, (appear.get(p) || 0) + 1);
    }
  }
  let meKey = null;
  if (opts.ja) {
    for (const a of analyses) {
      const p = a.players.find((x) => playerName(x).toLowerCase() === opts.ja.toLowerCase());
      if (p) { meKey = playerKey(p); break; }
    }
    if (!meKey) fail(`Hrac "${opts.ja}" v zadnem replayi neni.`);
  } else {
    const sorted = [...appear.entries()].sort((x, y) => y[1] - x[1]);
    if (sorted.length && (analyses.length === 1 || sorted[0][1] > (sorted[1] ? sorted[1][1] : 0))) {
      meKey = sorted[0][0];
    }
  }

  const inWindow = (a, o) => {
    if (!opts.od && !opts.do) return true;
    if (!a.start) return false;
    const t = new Date(a.start.getTime() + o.timeSeconds * 1000);
    return (!opts.od || t >= opts.od) && (!opts.do || t < opts.do);
  };

  const totals = new Map(); // key -> { name, chest, ammo, games }
  let myChests = 0;
  let myAmmo = 0;
  let unknownTotal = 0;
  const warnTypes = new Set();

  console.log('\n' + '='.repeat(70));
  for (const a of analyses) {
    a.otherChestTypes.forEach((t) => warnTypes.add(t));
    const me = a.players.find((p) => playerKey(p) === meKey);
    const myTeam = teamOf(me);

    const counts = new Map();
    let unknown = 0;
    for (const o of a.opens) {
      if (!inWindow(a, o)) continue;
      if (!o.player) { unknown++; continue; }
      const k = playerKey(o.player);
      const c = counts.get(k) || { p: o.player, chest: 0, ammo: 0 };
      c[o.kind]++;
      counts.set(k, c);
    }
    unknownTotal += unknown;

    const team = [...counts.values()].filter((c) => playerKey(c.p) === meKey
      || (myTeam !== null && teamOf(c.p) === myTeam));
    const mine = counts.get(meKey);
    if (mine) { myChests += mine.chest; myAmmo += mine.ammo; }

    for (const c of team) {
      const k = playerKey(c.p);
      const t = totals.get(k) || { name: playerName(c.p), chest: 0, ammo: 0 };
      t.chest += c.chest;
      t.ammo += c.ammo;
      totals.set(k, t);
    }

    const skipped = opts.do && a.start && a.start >= opts.do ? '  (cely po casovem limitu)' : '';
    console.log(`\n${path.basename(a.file)}  -  ${fmt(a.start)}${skipped}`);
    if (!team.length) console.log('   tvuj tym: 0 truhel');
    for (const c of team.sort((x, y) => y.chest - x.chest)) {
      const tag = playerKey(c.p) === meKey ? ' (ty)' : '';
      console.log(`   ${playerName(c.p)}${tag}: truhly ${c.chest}, bedny s municí ${c.ammo}`);
    }
    if (opts.detail) {
      const others = [...counts.values()].filter((c) => !team.includes(c));
      for (const c of others) console.log(`   [jiny tym] ${playerName(c.p)}: truhly ${c.chest}, bedny ${c.ammo}`);
      if (unknown) console.log(`   neznamo kdo: ${unknown}`);
      if (a.alreadyOpenUnknown) console.log(`   uz otevrene, kdyz jsi je potkal: ${a.alreadyOpenUnknown}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`CELKEM za ${analyses.length} replayu:`);
  if (meKey) {
    console.log(`\n  >>> TY: ${myChests} truhel, ${myAmmo} beden s municí <<<\n`);
  } else {
    console.log('\n  Nepodarilo se poznat, kdo jsi ty. Spust znovu s --ja TvojeJmeno.\n');
  }
  for (const t of [...totals.values()].sort((x, y) => y.chest - x.chest)) {
    console.log(`  ${t.name}: ${t.chest} truhel, ${t.ammo} beden`);
  }
  if (unknownTotal) console.log(`\n  (${unknownTotal} otevreni se nepodarilo priradit zadnemu hraci)`);

  console.log('\nPozor:');
  console.log(' - Pocitaji se jen zapasy, ktere mas jako replay. Zapas bez replaye tu chybi.');
  console.log(' - Truhly spoluhracu se zapisou jen tehdy, kdyz byli dost blizko tebe');
  console.log('   (replay uklada jen to, co tvoje hra videla). Tvoje vlastni truhly se zapisou vzdy.');
  if (warnTypes.size) {
    console.log(' - Replaye obsahuji i dalsi typy truhel, ktere se NEPOCITAJI:');
    for (const t of warnTypes) console.log(`     ${t}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
