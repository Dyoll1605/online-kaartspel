/* server.js
   Regelt: server-hosting (Express), realtime sockets (Socket.IO), kamers in-memory,
   deck-samenstelling, delen van kaarten, slag/turn-logica, 3-wint-direct, set-validatie,
   dummy/bot speler bij 2 humans, en game-end.
*/

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

/* --- Game constants --- */
const RANK_ORDER = ["4","5","6","7","8","9","10","J","Q","K","A","2","3"];
const RANK_TO_SORT = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i + 1])); // higher means stronger
const SUITS = ["♣","♦","♥","♠"];

function makeDeck(numDecks = 1) {
  // Creates deck with unique ids so duplicates across decks are safeç
  const deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANK_ORDER) {
        deck.push({
          id: `${d}-${rank}-${suit}-${Math.random().toString(16).slice(2, 8)}`,
          rank,
          suit,
          sort: RANK_TO_SORT[rank]
        });
      }
    }
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function roomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/* --- In-memory rooms --- */
const rooms = new Map();
/*
room = {
  code,
  hostId,
  phase: "lobby"|"playing"|"ended",
  players: [ {id,name,emoji,color,isBot, socketId, hand:[], cardCount, passed} ],
  turnIndex: 0,
  pile: { rank, count, cardsShown, lastPlayedBy, passes:Set(playerId) } | null,
  winner: playerPublic | null
}
*/

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    isBot: !!p.isBot,
    cardCount: Array.isArray(p.hand) ? p.hand.length : (p.cardCount ?? 0)
  };
}

function snapshotFor(room, playerId) {
  const you = room.players.find(p => p.id === playerId);
  return {
    roomCode: room.code,
    phase: room.phase,
    hostId: room.hostId,
    turnPlayerId: room.phase === "playing" ? room.players[room.turnIndex]?.id : null,
    players: room.players.map(publicPlayer),
    pile: room.pile ? {
      rank: room.pile.rank,
      count: room.pile.count,
      cardsShown: room.pile.cardsShown,
      lastPlayedBy: room.pile.lastPlayedBy,
      // pass info is intentionally not fully shown in UI; could be expanded later
    } : null,
    hand: you ? you.hand : null,
    winner: room.winner,
    canRematch: room.phase === "ended",
    endReason: room.phase === "ended" && room.winner ? `${room.winner.name} is als eerste door z’n kaarten heen.` : null
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    if (p.isBot) continue;
    io.to(p.socketId).emit("roomUpdate", snapshotFor(room, p.id));
  }
}

function toast(room, text, kind = "info") {
  for (const p of room.players) {
    if (p.isBot) continue;
    io.to(p.socketId).emit("toast", { text, kind });
  }
}

/* --- Turn helpers --- */
function nextActiveIndex(room, startIdx) {
  // skip players who are out (0 cards) AFTER game is still playing
  const n = room.players.length;
  let i = startIdx;
  for (let step = 0; step < n; step++) {
    i = (i + 1) % n;
    const p = room.players[i];
    if (p.hand.length > 0) return i;
  }
  return startIdx;
}

function currentPlayer(room) {
  return room.players[room.turnIndex];
}

function countHumans(room) {
  return room.players.filter(p => !p.isBot).length;
}

/* --- Slag logic --- */
function resetPile(room, starterId = null) {
  room.pile = null;
  // turnIndex already points to starter
  if (starterId) {
    const idx = room.players.findIndex(p => p.id === starterId);
    if (idx >= 0) room.turnIndex = idx;
  }
}

function allOthersPassed(room, lastPlayerId) {
  const activePlayers = room.players.filter(p => p.hand.length > 0);
  const last = activePlayers.find(p => p.id === lastPlayerId);
  if (!last) return false;

  // everyone else either passed OR is out
  const passSet = room.pile?.passes || new Set();
  for (const p of activePlayers) {
    if (p.id === lastPlayerId) continue;
    if (!passSet.has(p.id)) return false;
  }
  return true;
}

function validatePlay(room, player, cardIds) {
  // Returns {ok:true, play:{rank,count,isThree,cardsShown}} or {ok:false,error}
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return { ok: false, error: "Selecteer minimaal één kaart." };
  }

  const cards = cardIds.map(id => player.hand.find(c => c.id === id)).filter(Boolean);
  if (cards.length !== cardIds.length) return { ok: false, error: "Je probeert kaarten te spelen die je niet hebt." };

  const ranks = new Set(cards.map(c => c.rank));
  if (ranks.size !== 1) return { ok: false, error: "Ongeldige zet: alleen sets met gelijke waarde." };

  const rank = cards[0].rank;
  const count = cards.length;
  const isThree = rank === "3";

  // Special: 3 always wins immediately, but still must be your turn, and you must play actual cards (done above).
  if (isThree) {
    return { ok: true, play: { rank, count, isThree, cardsShown: cards.map(({rank,suit}) => ({rank,suit})) } };
  }

  // Normal play: match pile count if pile exists
  if (room.pile && room.pile.rank) {
    if (count !== room.pile.count) {
      return { ok: false, error: `Ongeldige zet: je moet precies ${room.pile.count} kaart(en) spelen.` };
    }
    const curSort = RANK_TO_SORT[room.pile.rank];
    const yourSort = RANK_TO_SORT[rank];
    if (yourSort <= curSort) {
      return { ok: false, error: "Ongeldige zet: kaart te laag (je moet hoger spelen)." };
    }
  }

  // Starting a slag: any non-3 set allowed
  return { ok: true, play: { rank, count, isThree: false, cardsShown: cards.map(({rank,suit}) => ({rank,suit})) } };
}

function applyPlay(room, player, cardIds, play) {
  // Remove cards from hand
  player.hand = player.hand.filter(c => !cardIds.includes(c.id));

  // Update pile and passes
  if (!room.pile) {
    room.pile = {
      rank: play.rank,
      count: play.count,
      cardsShown: play.cardsShown,
      lastPlayedBy: player.id,
      passes: new Set()
    };
  } else {
    room.pile.rank = play.rank;
    room.pile.count = play.count;
    room.pile.cardsShown = play.cardsShown;
    room.pile.lastPlayedBy = player.id;
    room.pile.passes = new Set(); // reset passes after a play
  }
}

function endGameIfWinner(room, player) {
  if (player.hand.length === 0) {
    room.phase = "ended";
    room.winner = publicPlayer(player);
    toast(room, `${player.name} heeft gewonnen!`, "ok");
    return true;
  }
  return false;
}

function advanceTurn(room) {
  room.turnIndex = nextActiveIndex(room, room.turnIndex);
}

function botMaybeAct(room) {
  // Dummy/bot logic: always pass when it is bot's turn.
  if (room.phase !== "playing") return;
  const p = currentPlayer(room);
  if (!p?.isBot) return;

  // Bot passes and turn goes on. (Hand stays secret.)
  if (!room.pile) {
    // No pile yet; bot can't start? We allow bot to pass, but then someone must start.
    // To avoid a deadlock, if pile is empty and bot is starter, we force bot to pass and move to next.
    toast(room, `Dummy past.`, "info");
    room.turnIndex = nextActiveIndex(room, room.turnIndex);
    broadcastRoom(room);
    // If next is bot again (unlikely), recurse once more safely
    if (currentPlayer(room)?.isBot) botMaybeAct(room);
    return;
  }

  if (!room.pile.passes) room.pile.passes = new Set();
  room.pile.passes.add(p.id);
  toast(room, `Dummy past.`, "info");

  // If everyone else passed and lastPlayedBy exists, close slag
  if (room.pile.lastPlayedBy && allOthersPassed(room, room.pile.lastPlayedBy)) {
    const winnerId = room.pile.lastPlayedBy;
    toast(room, `Slag gewonnen door ${room.players.find(x => x.id === winnerId)?.name || "?"}.`, "ok");
    resetPile(room, winnerId);
  } else {
    room.turnIndex = nextActiveIndex(room, room.turnIndex);
  }

  broadcastRoom(room);
  if (currentPlayer(room)?.isBot) botMaybeAct(room);
}

/* --- Game start --- */
function dealHands(room) {
  const humans = countHumans(room);
  const numDecks = humans >= 5 ? 2 : 1;
  const deck = shuffle(makeDeck(numDecks));

  // If exactly 2 humans, add bot (if not present)
  if (humans === 2 && !room.players.some(p => p.isBot)) {
    room.players.push({
      id: `bot-${room.code}`,
      name: "Dummy",
      emoji: "🤖",
      color: "#9fb0c3",
      isBot: true,
      socketId: null,
      hand: []
    });
  }

  // Determine hand size (8–15), roughly proportional to players and deck size
  const n = room.players.length;
  const suggested = Math.floor(deck.length / n / 1.2);
  const handSize = Math.max(8, Math.min(15, suggested));

  for (const p of room.players) p.hand = [];

  for (let i = 0; i < handSize; i++) {
    for (const p of room.players) {
      const card = deck.pop();
      if (!card) break;
      p.hand.push(card);
    }
  }

  // Random starter
  room.turnIndex = Math.floor(Math.random() * room.players.length);
  room.pile = null;
  room.winner = null;

  // If starter is bot, let bot pass and move to next (so a human starts quickly)
  if (currentPlayer(room)?.isBot) {
    room.turnIndex = nextActiveIndex(room, room.turnIndex);
  }
}

/* --- Socket wiring --- */
io.on("connection", (socket) => {
  // Track which room/player this socket belongs to
  socket.data.playerId = null;
  socket.data.roomCode = null;

  socket.on("createRoom", (profile, cb) => {
    let code;
    do { code = roomCode(); } while (rooms.has(code));

    const playerId = socket.id;
    const you = {
      id: playerId,
      name: (profile?.name || "Speler").slice(0, 18),
      emoji: profile?.emoji || "🦊",
      color: profile?.color || "#6ae4a6",
      isBot: false,
      socketId: socket.id,
      hand: []
    };

    const room = {
      code,
      hostId: playerId,
      phase: "lobby",
      players: [you],
      turnIndex: 0,
      pile: null,
      winner: null
    };

    rooms.set(code, room);
    socket.join(code);

    socket.data.playerId = playerId;
    socket.data.roomCode = code;

    cb?.({ ok: true, roomCode: code, you: publicPlayer(you) });
    toast(room, `${you.name} heeft kamer ${code} gemaakt.`, "ok");
    broadcastRoom(room);
  });

  socket.on("joinRoom", ({ roomCode, profile }, cb) => {
    const code = (roomCode || "").toUpperCase().slice(0, 6);
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Kamer niet gevonden." });
    if (room.phase !== "lobby") return cb?.({ ok: false, error: "Spel is al gestart in deze kamer." });

    // Avoid duplicate joins by same socket
    const existing = room.players.find(p => p.id === socket.id);
    if (existing) {
      socket.join(code);
      socket.data.playerId = socket.id;
      socket.data.roomCode = code;
      cb?.({ ok: true, you: publicPlayer(existing) });
      broadcastRoom(room);
      return;
    }

    const you = {
      id: socket.id,
      name: (profile?.name || "Speler").slice(0, 18),
      emoji: profile?.emoji || "🦊",
      color: profile?.color || "#6ae4a6",
      isBot: false,
      socketId: socket.id,
      hand: []
    };

    room.players.push(you);
    socket.join(code);

    socket.data.playerId = you.id;
    socket.data.roomCode = code;

    cb?.({ ok: true, you: publicPlayer(you) });
    toast(room, `${you.name} joined.`, "ok");
    broadcastRoom(room);
  });

  socket.on("leaveRoom", (_, cb) => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: true });

    room.players = room.players.filter(p => p.id !== playerId);
    socket.leave(code);

    // If host left, assign new host
    if (room.hostId === playerId) {
      const nextHost = room.players.find(p => !p.isBot);
      room.hostId = nextHost?.id || null;
      if (room.hostId) toast(room, `${nextHost.name} is nu host.`, "warn");
    }

    // If no humans remain, delete room
    if (room.players.filter(p => !p.isBot).length === 0) {
      rooms.delete(code);
      return cb?.({ ok: true });
    }

    // If game was playing, we snap back to lobby to keep it simple and safe
    room.phase = "lobby";
    room.pile = null;
    room.winner = null;

    toast(room, `Iemand verliet de kamer. Terug naar lobby.`, "warn");
    broadcastRoom(room);

    socket.data.roomCode = null;
    socket.data.playerId = null;
    cb?.({ ok: true });
  });

  socket.on("startGame", (_, cb) => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Kamer niet gevonden." });
    if (room.hostId !== playerId) return cb?.({ ok: false, error: "Alleen de host kan starten." });
    if (room.players.filter(p => !p.isBot).length < 2) return cb?.({ ok: false, error: "Minstens 2 spelers nodig." });

    room.phase = "playing";
    dealHands(room);
    toast(room, `Spel gestart. ${room.players[room.turnIndex].name} begint.`, "ok");

    broadcastRoom(room);
    botMaybeAct(room);
    cb?.({ ok: true });
  });

  socket.on("backToLobby", (_, cb) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Kamer niet gevonden." });

    room.phase = "lobby";
    room.pile = null;
    room.winner = null;
    for (const p of room.players) p.hand = [];

    toast(room, "Terug naar lobby.", "info");
    broadcastRoom(room);
    cb?.({ ok: true });
  });

  socket.on("playCards", ({ cardIds }, cb) => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Kamer niet gevonden." });
    if (room.phase !== "playing") return cb?.({ ok: false, error: "Spel is niet bezig." });

    const p = currentPlayer(room);
    if (!p || p.id !== playerId) return cb?.({ ok: false, error: "Ander speler is aan de beurt." });

    if (!room.pile) {
      // initialize pile passes
      room.pile = {
        rank: null,
        count: null,
        cardsShown: [],
        lastPlayedBy: null,
        passes: new Set()
      };
    }

    // If player had previously passed this slag, they can't jump back in (simple and consistent)
    if (room.pile.passes?.has(playerId)) {
      return cb?.({ ok: false, error: "Je hebt al gepast in deze slag." });
    }

    const valid = validatePlay(room, p, cardIds);
    if (!valid.ok) return cb?.(valid);

    // Apply play
    applyPlay(room, p, cardIds, valid.play);

    // Check endgame
    if (endGameIfWinner(room, p)) {
      broadcastRoom(room);
      return cb?.({ ok: true });
    }

    // 3 wins slag immediately
    if (valid.play.isThree) {
      toast(room, `🟢 ${p.name} speelde een 3: slag direct gewonnen.`, "ok");
      resetPile(room, p.id);
      broadcastRoom(room);
      botMaybeAct(room);
      return cb?.({ ok: true });
    }

    // Normal: advance to next active
    room.turnIndex = nextActiveIndex(room, room.turnIndex);
    toast(room, `${p.name} speelde ${valid.play.count}× ${valid.play.rank}.`, "info");

    broadcastRoom(room);
    botMaybeAct(room);
    cb?.({ ok: true });
  });

  socket.on("pass", (_, cb) => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Kamer niet gevonden." });
    if (room.phase !== "playing") return cb?.({ ok: false, error: "Spel is niet bezig." });

    const p = currentPlayer(room);
    if (!p || p.id !== playerId) return cb?.({ ok: false, error: "Ander speler is aan de beurt." });

    // If no pile exists, you can pass, but someone must eventually start.
    if (!room.pile) {
      room.pile = { rank: null, count: null, cardsShown: [], lastPlayedBy: null, passes: new Set() };
    }

    if (!room.pile.passes) room.pile.passes = new Set();
    room.pile.passes.add(playerId);

    toast(room, `${p.name} past.`, "info");

    // If there is a lastPlayedBy and everyone else passed, close slag
    if (room.pile.lastPlayedBy && allOthersPassed(room, room.pile.lastPlayedBy)) {
      const winnerId = room.pile.lastPlayedBy;
      const winner = room.players.find(x => x.id === winnerId);
      toast(room, `Slag gewonnen door ${winner?.name || "?"}. Die start opnieuw.`, "ok");
      resetPile(room, winnerId);
    } else {
      room.turnIndex = nextActiveIndex(room, room.turnIndex);
    }

    broadcastRoom(room);
    botMaybeAct(room);
    cb?.({ ok: true });
  });

  socket.on("rematch", (_, cb) => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Kamer niet gevonden." });
    if (room.hostId !== playerId) return cb?.({ ok: false, error: "Alleen host kan rematch starten." });
    if (room.phase !== "ended") return cb?.({ ok: false, error: "Rematch kan pas na einde." });

    room.phase = "playing";
    dealHands(room);
    toast(room, "Nieuwe ronde gestart.", "ok");
    broadcastRoom(room);
    botMaybeAct(room);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room = rooms.get(code);
    if (!room) return;

    // Remove player on disconnect
    room.players = room.players.filter(p => p.id !== playerId);

    if (room.hostId === playerId) {
      const nextHost = room.players.find(p => !p.isBot);
      room.hostId = nextHost?.id || null;
      if (room.hostId) toast(room, `${nextHost.name} is nu host.`, "warn");
    }

    // Cleanup if no humans
    if (room.players.filter(p => !p.isBot).length === 0) {
      rooms.delete(code);
      return;
    }

    // Safety: return to lobby if someone drops during play
    if (room.phase !== "lobby") {
      room.phase = "lobby";
      room.pile = null;
      room.winner = null;
      for (const p of room.players) p.hand = [];
      toast(room, "Iemand disconnectte. Terug naar lobby.", "warn");
    }

    broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
