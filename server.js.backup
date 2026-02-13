const path    = require("path");
const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const RANKS     = ["4","5","6","7","8","9","10","J","Q","K","A","2","3"];
const RANK_SORT = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUITS     = ["klaver","ruit","hart","schop"];
const SUIT_SYM  = { klaver:"♣", ruit:"♦", hart:"♥", schop:"♠" };

function makeDeck(numDecks) {
  const deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({
          id:   d + "-" + rank + "-" + suit + "-" + Math.random().toString(16).slice(2,8),
          rank,
          suit: SUIT_SYM[suit],
          sort: RANK_SORT[rank],
        });
      }
    }
  }
  return deck;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function genRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const rooms = new Map();

function pub(p) {
  return { id: p.id, name: p.name, emoji: p.emoji, color: p.color, cardCount: p.hand.length };
}

function snap(room, pid) {
  const you  = room.players.find(p => p.id === pid);
  const turn = room.phase === "playing" ? room.players[room.turnIndex] : null;
  const result = room.result ? {
    loserId: room.result.loserId,
    ranking: room.result.ranking,
  } : null;
  return {
    roomCode:     room.code,
    phase:        room.phase,
    hostId:       room.hostId,
    turnPlayerId: turn ? turn.id : null,
    players:      room.players.map(pub),
    hand:         you ? you.hand : [],
    pile:         (room.round && room.round.pile) ? room.round.pile : null,
    result:       result,
  };
}

function bcast(room) {
  for (const p of room.players) io.to(p.socketId).emit("roomUpdate", snap(room, p.id));
}

function toast(room, text, kind) {
  for (const p of room.players) io.to(p.socketId).emit("toast", { text: text, kind: kind || "info" });
}

function cur(room) { return room.players[room.turnIndex]; }

function setTurn(room, pid) {
  const idx = room.players.findIndex(p => p.id === pid);
  if (idx >= 0) room.turnIndex = idx;
}

function dealEqual(room) {
  const nd   = room.players.length >= 5 ? 2 : 1;
  const deck = shuffle(makeDeck(nd));
  const n    = room.players.length;
  const base = Math.floor(deck.length / n);
  for (const p of room.players) p.hand = [];
  for (let i = 0; i < base; i++) {
    for (const p of room.players) p.hand.push(deck.pop());
  }
}

function cwOrder(room, startId) {
  const n    = room.players.length;
  const si   = room.players.findIndex(p => p.id === startId);
  const ord  = [];
  for (let k = 0; k < n; k++) {
    const p = room.players[(si + k) % n];
    if (p.hand.length > 0) ord.push(p.id);
  }
  return ord;
}

function startRound(room, startId) {
  const w = room.players.find(p => p.id === startId);
  if (!w || w.hand.length === 0) {
    const idx = room.players.findIndex(p => p.id === startId);
    const n   = room.players.length;
    for (let k = 1; k <= n; k++) {
      const p = room.players[(idx + k) % n];
      if (p.hand.length > 0) { startId = p.id; break; }
    }
  }
  room.round = {
    starterId: startId,
    order:     cwOrder(room, startId),
    acted:     [],
    pile:      null,
  };
  setTurn(room, startId);
  toast(room, "Nieuwe ronde. " + (cur(room) ? cur(room).name : "?") + " opent.", "info");
}

function markDone(room, pid) {
  const p = room.players.find(x => x.id === pid);
  if (!p || p.hand.length !== 0) return;
  if (room.finishOrder.indexOf(p.id) === -1) {
    room.finishOrder.push(p.id);
    toast(room, p.name + " is klaar!", "ok");
  }
}

function checkEnd(room) {
  const still = room.players.filter(p => p.hand.length > 0);
  if (still.length > 1) return false;
  room.phase = "ended";
  const loser   = still[0] || null;
  const ranking = room.finishOrder.slice();
  if (loser && ranking.indexOf(loser.id) === -1) ranking.push(loser.id);
  room.result = {
    loserId: loser ? loser.id : null,
    ranking: ranking.map(function(id) {
      const pl = room.players.find(x => x.id === id);
      return pl ? pub(pl) : { id: id, name: "?", emoji: "🎴", color: "#999", cardCount: 0 };
    }),
  };
  toast(room, loser ? "Spel klaar! Verliezer: " + loser.name : "Spel klaar!", "warn");
  return true;
}

function endRound(room, winnerId) {
  room.round.pile = null;
  bcast(room);
  const w = room.players.find(p => p.id === winnerId);
  toast(room, (w ? w.name : "?") + " wint de ronde! Tafel leeg.", "ok");
  if (checkEnd(room)) { bcast(room); return; }
  setTimeout(function() {
    startRound(room, winnerId);
    bcast(room);
  }, 300);
}

function validate(room, player, cardIds) {
  if (!cardIds || cardIds.length === 0) return { ok: false, error: "Selecteer minstens 1 kaart." };
  const cards = cardIds.map(function(id) { return player.hand.find(c => c.id === id); }).filter(Boolean);
  if (cards.length !== cardIds.length)  return { ok: false, error: "Je hebt deze kaarten niet." };
  const rank = cards[0].rank;
  for (const c of cards) if (c.rank !== rank) return { ok: false, error: "Alle kaarten moeten dezelfde waarde hebben." };
  const count = cards.length;
  const isThree = rank === "3";
  if (isThree) return { ok: true, play: { rank: rank, count: count, isThree: true, cardsShown: cards.map(c => ({ rank: c.rank, suit: c.suit })) } };
  const pile = room.round.pile;
  if (pile) {
    if (count !== pile.count) return { ok: false, error: "Moet exact " + pile.count + " kaart(en) zijn." };
    if (RANK_SORT[rank] <= RANK_SORT[pile.rank]) return { ok: false, error: "Te laag — speel hoger of pas." };
  }
  return { ok: true, play: { rank: rank, count: count, isThree: false, cardsShown: cards.map(c => ({ rank: c.rank, suit: c.suit })) } };
}

function applyPlay(room, player, cardIds, play) {
  player.hand = player.hand.filter(c => cardIds.indexOf(c.id) === -1);
  room.round.pile = { rank: play.rank, count: play.count, cardsShown: play.cardsShown, lastPlayedBy: player.id };
}

function advanceLap(room) {
  const order = room.round.order;
  const acted = room.round.acted;
  for (let i = 0; i < order.length; i++) {
    const pid = order[i];
    if (acted.indexOf(pid) !== -1) continue;
    const p = room.players.find(x => x.id === pid);
    if (!p || p.hand.length === 0) { acted.push(pid); continue; }
    setTurn(room, pid);
    return true;
  }
  return false;
}

function afterAction(room) {
  const moved = advanceLap(room);
  if (!moved) {
    const pile = room.round.pile;
    if (pile && pile.lastPlayedBy) {
      endRound(room, pile.lastPlayedBy);
    } else {
      toast(room, "Iedereen paste. Zelfde opener.", "warn");
      endRound(room, room.round.starterId);
    }
  } else {
    bcast(room);
  }
}

function resetToLobby(room) {
  room.phase = "lobby"; room.round = null; room.finishOrder = []; room.result = null;
  for (const p of room.players) p.hand = [];
}

io.on("connection", function(socket) {
  socket.data.roomCode = null;

  socket.on("createRoom", function(profile, cb) {
    let code;
    do { code = genRoomCode(); } while (rooms.has(code));
    const you = { id: socket.id, name: ((profile && profile.name) || "Speler").slice(0,18), emoji: (profile && profile.emoji) || "🦊", color: (profile && profile.color) || "#6ae4a6", socketId: socket.id, hand: [] };
    const room = { code: code, hostId: you.id, phase: "lobby", players: [you], turnIndex: 0, round: null, finishOrder: [], result: null };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    if (cb) cb({ ok: true, roomCode: code, you: pub(you) });
    bcast(room);
  });

  socket.on("joinRoom", function(data, cb) {
    const code = ((data && data.roomCode) || "").toUpperCase().slice(0,6);
    const profile = data && data.profile;
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: "Kamer niet gevonden." });
    if (room.phase !== "lobby") return cb && cb({ ok: false, error: "Spel is al gestart." });
    const you = { id: socket.id, name: ((profile && profile.name) || "Speler").slice(0,18), emoji: (profile && profile.emoji) || "🦊", color: (profile && profile.color) || "#6ae4a6", socketId: socket.id, hand: [] };
    room.players.push(you);
    socket.join(code);
    socket.data.roomCode = code;
    if (cb) cb({ ok: true, roomCode: code, you: pub(you) });
    toast(room, you.name + " joined.", "ok");
    bcast(room);
  });

  socket.on("startGame", function(_, cb) {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false, error: "Kamer niet gevonden." });
    if (room.hostId !== socket.id) return cb && cb({ ok: false, error: "Alleen host kan starten." });
    if (room.players.length < 2) return cb && cb({ ok: false, error: "Minstens 2 spelers nodig." });
    room.phase = "playing"; room.finishOrder = []; room.result = null;
    dealEqual(room);
    let sid = room.hostId;
    if (!room.players.find(p => p.id === sid && p.hand.length > 0)) sid = (room.players.find(p => p.hand.length > 0) || room.players[0]).id;
    startRound(room, sid);
    bcast(room);
    if (cb) cb({ ok: true });
  });

  socket.on("playCards", function(data, cb) {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false, error: "Kamer niet gevonden." });
    if (room.phase !== "playing") return cb && cb({ ok: false, error: "Spel is niet bezig." });
    const p = cur(room);
    if (!p || p.id !== socket.id) return cb && cb({ ok: false, error: "Jij bent niet aan de beurt." });
    if (p.hand.length === 0) return cb && cb({ ok: false, error: "Je hebt geen kaarten." });
    if (room.round.acted.indexOf(p.id) !== -1) return cb && cb({ ok: false, error: "Je hebt al gespeeld deze ronde." });
    const cardIds = data && data.cardIds;
    const v = validate(room, p, cardIds);
    if (!v.ok) return cb && cb(v);
    room.round.acted.push(p.id);
    applyPlay(room, p, cardIds, v.play);
    markDone(room, p.id);
    if (v.play.isThree) {
      toast(room, "🟢 " + p.name + " speelde een 3 — ronde direct gewonnen!", "ok");
      bcast(room);
      endRound(room, p.id);
      return cb && cb({ ok: true });
    }
    toast(room, p.name + " speelde " + v.play.count + "x " + v.play.rank + ".", "info");
    afterAction(room);
    if (cb) cb({ ok: true });
  });

  socket.on("pass", function(_, cb) {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false, error: "Kamer niet gevonden." });
    if (room.phase !== "playing") return cb && cb({ ok: false, error: "Spel is niet bezig." });
    const p = cur(room);
    if (!p || p.id !== socket.id) return cb && cb({ ok: false, error: "Jij bent niet aan de beurt." });
    if (p.hand.length === 0) return cb && cb({ ok: false, error: "Je hebt geen kaarten." });
    if (room.round.acted.indexOf(p.id) !== -1) return cb && cb({ ok: false, error: "Je hebt al geacteerd deze ronde." });
    if (!room.round.pile && room.round.starterId === p.id) return cb && cb({ ok: false, error: "Jij opent de ronde — je moet een kaart spelen." });
    room.round.acted.push(p.id);
    toast(room, p.name + " past.", "info");
    afterAction(room);
    if (cb) cb({ ok: true });
  });

  socket.on("backToLobby", function(_, cb) {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false, error: "Kamer niet gevonden." });
    resetToLobby(room);
    toast(room, "Terug naar lobby.", "info");
    bcast(room);
    if (cb) cb({ ok: true });
  });

  socket.on("rematch", function(_, cb) {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb && cb({ ok: false, error: "Kamer niet gevonden." });
    if (room.hostId !== socket.id) return cb && cb({ ok: false, error: "Alleen host kan opnieuw starten." });
    room.phase = "playing"; room.finishOrder = []; room.result = null;
    dealEqual(room);
    let sid = room.hostId;
    if (!room.players.find(p => p.id === sid && p.hand.length > 0)) sid = (room.players.find(p => p.hand.length > 0) || room.players[0]).id;
    startRound(room, sid);
    bcast(room);
    if (cb) cb({ ok: true });
  });

  socket.on("leaveRoom", function(_, cb) {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: true });
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(code);
    socket.data.roomCode = null;
    if (room.players.length === 0) { rooms.delete(code); return cb && cb({ ok: true }); }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    resetToLobby(room);
    toast(room, "Iemand verliet de kamer.", "warn");
    bcast(room);
    if (cb) cb({ ok: true });
  });

  socket.on("disconnect", function() {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) { rooms.delete(code); return; }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    resetToLobby(room);
    toast(room, "Iemand disconnectte. Terug naar lobby.", "warn");
    bcast(room);
  });
});

server.listen(PORT, function() {
  console.log("Server running on http://localhost:" + PORT);
});
