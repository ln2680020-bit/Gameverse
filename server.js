const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { Chess } = require('chess.js');
const srv = http.createServer((q, r) => {
  const f = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(fs.existsSync);
  if (!f) { r.writeHead(500); return r.end('Khong tim thay index.html'); }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(f));
});
const wss = new WebSocketServer({ server: srv });
const GAMES = { caro: { max: 2 }, noitu: { max: 6 }, ott: { max: 2 }, ccn: { max: 4 }, chess: { max: 2 } }, rooms = {};
const CCN_COLORS = ['red', 'yellow', 'blue', 'green'];
const CCN_START = { red: 0, yellow: 26, blue: 13, green: 39 };
const CCN_SAFE = new Set([0, 13, 26, 39]);
let uid = 0, chatSeq = 0;
const chatHistory = [];
const EMOTES = new Set(['👍','❤️','😂','😮','🔥','👏']);
const send = (c, o) => c.readyState === 1 && c.send(JSON.stringify(o));
const mkcode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function lobby() {
  const rooms_ = Object.values(rooms).filter(r => r.pub).map(r => ({
    code: r.code, game: r.game, host: r.players[0].name, n: r.players.length, max: GAMES[r.game].max, on: r.on }));
  wss.clients.forEach(c => send(c, { t: 'lobby', rooms: rooms_, online: wss.clients.size }));
}
function sync(r) {
  const o = { t: 'room', code: r.code, game: r.game, host: r.players[0].id, on: r.on,
    players: r.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready, color: p.color })), max: GAMES[r.game].max, pub: r.pub, g: r.g,
    ms: r.g && r.g.deadline ? Math.max(0, r.g.deadline - Date.now()) : 0 };
  r.players.forEach(p => send(p, o)); lobby();
}
function leave(c) {
  const r = c.room; if (!r) return;
  c.room = null; r.players = r.players.filter(p => p !== c);
  send(c, { t: 'left' });
  if (!r.players.length) { clearTimeout(r.tm); delete rooms[r.code]; lobby(); return; }
  if (r.on) { r.on = false; clearTimeout(r.tm); r.g = null; }
  if (r.players[0]) r.players[0].ready = true;
  sync(r);
}
function tick(r) {
  clearTimeout(r.tm); if (!r.on) return;
  r.g.deadline = Date.now() + 20000;
  r.tm = setTimeout(() => { r.g.out.push(r.players[r.g.turn].id); next(r); sync(r); }, 20000);
}
function next(r) {
  const g = r.g, alive = r.players.filter(p => !g.out.includes(p.id));
  if (alive.length < 2) { r.on = false; g.win = alive[0] && alive[0].id; g.deadline = 0; clearTimeout(r.tm); return; }
  do { g.turn = (g.turn + 1) % r.players.length; } while (g.out.includes(r.players[g.turn].id));
  tick(r);
}
const N = 15;
function five(b, i, v) {
  const x = i % N, y = (i / N) | 0;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let n = 1;
    for (const s of [1, -1]) for (let k = 1; k < 5; k++) {
      const a = x + dx * k * s, c = y + dy * k * s;
      if (a < 0 || c < 0 || a >= N || c >= N || b[c * N + a] !== v) break; n++;
    }
    if (n >= 5) return true;
  }
  return false;
}
const syl = w => w.trim().toLowerCase().split(/\s+/);


function ccnLegal(r, player, die) {
  const horses = r.g.horses[player.id] || [];
  return horses.map((progress, i) => ({ i, progress }))
    .filter(x => x.progress === -1 ? die === 6 : x.progress < 57 && x.progress + die <= 57)
    .map(x => x.i);
}
function ccnRoll(r, c) {
  const g = r.g;
  if (!r.on || r.game !== 'ccn' || r.players[g.turn] !== c || g.die !== null) return;
  const die = 1 + Math.floor(Math.random() * 6);
  g.die = die; g.legal = ccnLegal(r, c, die);
  g.last = c.name + ' tung được ' + die + '.';
  if (!g.legal.length) {
    g.last += ' Không có quân hợp lệ để đi.';
    g.die = null; g.legal = [];
    if (die !== 6) g.turn = (g.turn + 1) % r.players.length;
  }
  sync(r);
}
function ccnMove(r, c, horseIndex) {
  const g = r.g;
  if (!r.on || r.game !== 'ccn' || r.players[g.turn] !== c || g.die === null) return;
  const i = Number(horseIndex);
  if (!Number.isInteger(i) || !g.legal.includes(i)) return;
  const horses = g.horses[c.id], die = g.die;
  horses[i] = horses[i] === -1 ? 0 : horses[i] + die;
  let captured = 0;
  if (horses[i] <= 51) {
    const cell = (CCN_START[c.color] + horses[i]) % 52;
    if (!CCN_SAFE.has(cell)) {
      r.players.forEach(p => {
        if (p.id === c.id) return;
        g.horses[p.id].forEach((progress, j) => {
          if (progress >= 0 && progress <= 51 && (CCN_START[p.color] + progress) % 52 === cell) {
            g.horses[p.id][j] = -1; captured++;
          }
        });
      });
    }
  }
  const finished = horses.filter(x => x === 57).length;
  g.last = c.name + ' di chuyển quân ' + (i + 1) + (captured ? ' và đá ' + captured + ' quân về chuồng.' : '.');
  if (finished === 4) {
    g.win = c.id; g.last = c.name + ' đã đưa cả 4 quân về đích!'; r.on = false;
  } else if (die !== 6) {
    g.turn = (g.turn + 1) % r.players.length;
  }
  g.die = null; g.legal = [];
  sync(r);
}

wss.on('connection', c => {
  c.id = ++uid; c.name = 'Khách ' + c.id; c.room = null;
  c.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const r = c.room;
    if (m.t === 'hello') {
      c.name = String(m.name || '').trim().slice(0, 16) || c.name;
      send(c, { t: 'me', id: c.id, name: c.name });
      if (!c.room) { chatHistory.forEach(item => send(c, item)); lobby(); } else sync(c.room);
    } else if (m.t === 'chat') {
      const text = String(m.text || '').trim().slice(0, 200); if (!text) return;
      const o = { t: 'chat', id: ++chatSeq, name: c.name, text, at: Date.now(), reactions: {} };
      const history = r ? (r.chatHistory || (r.chatHistory = [])) : chatHistory;
      history.push(o); if (history.length > 50) history.shift();
      (r ? r.players : [...wss.clients]).forEach(p => send(p, o));
    } else if (m.t === 'react') {
      const id = Number(m.id), emoji = String(m.emoji || '');
      if (!Number.isSafeInteger(id) || !EMOTES.has(emoji)) return;
      const history = r ? (r.chatHistory || []) : chatHistory;
      const item = history.find(x => x.id === id); if (!item) return;
      item.reactions = item.reactions || {};
      const users = new Set(item.reactions[emoji] || []);
      if (users.has(c.id)) users.delete(c.id); else users.add(c.id);
      item.reactions[emoji] = [...users];
      const update = { t: 'reaction', id, reactions: item.reactions };
      (r ? r.players : [...wss.clients]).forEach(p => send(p, update));
    } else if (m.t === 'create') {
      if (!GAMES[m.game]) return; leave(c);
      const room = { code: mkcode(), game: m.game, pub: !!m.pub, players: [c], on: false, g: null, chatHistory: [] }; c.ready = true;
      c.color = CCN_COLORS[0]; rooms[room.code] = room; c.room = room; sync(room);
    } else if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 6) return send(c, { t: 'err', msg: 'Mã phòng phải gồm 6 ký tự chữ hoặc số.' });
      const room = rooms[code];
      if (!room) return send(c, { t: 'err', msg: 'Không tìm thấy phòng. Hãy kiểm tra lại mã mời hoặc yêu cầu chủ phòng gửi mã mới.' });
      if (room.on || room.players.length >= GAMES[room.game].max) return send(c, { t: 'err', msg: 'Phòng đầy hoặc đang chơi' });
      if (room === r) return; leave(c);
      room.players.push(c); c.room = room; c.ready = false; c.color = CCN_COLORS.find(color => !room.players.some(p => p !== c && p.color === color)) || CCN_COLORS[0]; sync(room); (room.chatHistory || []).forEach(item => send(c, item));
    } else if (m.t === 'leave') leave(c);
    else if (m.t === 'ready' && r && !r.on) { c.ready = !!m.ready; if (r.players[0]) r.players[0].ready = true; sync(r); }
    else if (m.t === 'start' && r && !r.on && r.players[0] === c && r.players.length >= 2 && r.players.every(p => p.ready)) {
      r.on = true;
      r.g = r.game === 'caro'
        ? { b: Array(N * N).fill(0), turn: 0, win: null }
        : r.game === 'noitu'
          ? { words: [], turn: 0, out: [], win: null, deadline: 0 }
          : r.game === 'ott'
          ? { choices: {}, result: null, win: null, round: 1, score: Object.fromEntries(r.players.map(p => [p.id, 0])) }
          : r.game === 'ccn'
            ? { horses: Object.fromEntries(r.players.map(p => [p.id, [-1, -1, -1, -1]])), turn: 0, die: null, legal: [], win: null, last: 'Tung xúc xắc để bắt đầu.' }
            : { fen: new Chess().fen(), turn: 0, win: null, status: 'Trắng đi trước.' };
      if (r.game === 'noitu') tick(r);
      sync(r);
    } else if (m.t === 'nextRound' && r && r.on && r.game === 'ott' && r.g.result) {
      r.g.choices = {}; r.g.result = null; r.g.round++; r.g.win = null; sync(r);
    } else if (m.t === 'move' && r && r.on && r.game === 'chess') {
      const g = r.g; if (r.players[g.turn] !== c) return;
      const from = String(m.from || ''), to = String(m.to || '');
      if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return;
      try {
        const chess = new Chess(g.fen);
        const moved = chess.move({ from, to, promotion: 'q' });
        if (!moved) return send(c, { t: 'err', msg: 'Nước đi không hợp lệ. Hãy chọn lại quân và ô đến.' });
        g.fen = chess.fen(); g.turn = chess.turn() === 'w' ? 0 : 1;
        if (chess.isCheckmate()) { g.win = r.players[1 - g.turn].id; g.status = 'Chiếu hết!'; r.on = false; }
        else if (chess.isDraw()) { g.win = -1; g.status = 'Ván cờ hòa.'; r.on = false; }
        else g.status = chess.isCheck() ? 'Chiếu! Đến lượt ' + (g.turn === 0 ? 'Trắng' : 'Đen') + '.' : 'Đến lượt ' + (g.turn === 0 ? 'Trắng' : 'Đen') + '.';
      } catch { return send(c, { t: 'err', msg: 'Không thể thực hiện nước đi này.' }); }
      sync(r);
    } else if (m.t === 'roll' && r && r.on && r.game === 'ccn') {
      ccnRoll(r, c);
    } else if (m.t === 'move' && r && r.on) {
      const g = r.g; if (r.game !== 'ott' && r.players[g.turn] !== c) return;
      if (r.game === 'ccn') {
        ccnMove(r, c, m.horse);
        return;
      } else if (r.game === 'ott') {
        const choice = String(m.choice || '');
        if (!['rock', 'paper', 'scissors'].includes(choice) || g.choices[c.id]) return;
        g.choices[c.id] = choice;
        if (r.players.every(p => g.choices[p.id])) {
          const a = g.choices[r.players[0].id], b = g.choices[r.players[1].id];
          const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
          const winner = a === b ? -1 : beats[a] === b ? r.players[0].id : r.players[1].id;
          g.win = winner;
          if (winner !== -1) g.score[winner] = (g.score[winner] || 0) + 1;
          g.result = { choices: r.players.map(p => ({ id: p.id, choice: g.choices[p.id] })), winner, round: g.round };
          if (winner !== -1 && g.score[winner] >= 3) r.on = false;
        }
      } else if (r.game === 'caro') {
        const i = m.i | 0; if (i < 0 || i >= N * N || g.b[i]) return;
        g.b[i] = g.turn + 1;
        if (five(g.b, i, g.turn + 1)) { g.win = c.id; r.on = false; }
        else if (!g.b.includes(0)) { g.win = -1; r.on = false; }
        else g.turn = 1 - g.turn;
      } else {
        const w = String(m.w || '').trim().slice(0, 40), s = syl(w);
        if (s.length < 2 || g.words.some(x => x.w.toLowerCase() === w.toLowerCase())) return send(c, { t: 'err', msg: 'Từ phải có 2 tiếng và chưa dùng' });
        const last = g.words.length && syl(g.words[g.words.length - 1].w);
        if (last && last[last.length - 1] !== s[0]) return send(c, { t: 'err', msg: 'Tiếng đầu phải trùng tiếng cuối từ trước' });
        g.words.push({ w, by: c.id }); next(r);
      }
      sync(r);
    }
  });
  c.on('close', () => { leave(c); lobby(); });
});
srv.listen(process.env.PORT || 3000, () => console.log('Chạy tại http://localhost:' + (process.env.PORT || 3000)));
