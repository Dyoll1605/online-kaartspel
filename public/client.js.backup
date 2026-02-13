const socket = io();
const $ = function(id) { return document.getElementById(id); };

const nameInput    = $("nameInput");
const emojiSelect  = $("emojiSelect");
const colorSelect  = $("colorSelect");
const createBtn    = $("createBtn");
const joinBtn      = $("joinBtn");
const roomInput    = $("roomInput");
const startBtn     = $("startBtn");
const leaveBtn     = $("leaveBtn");
const roomPill     = $("roomPill");
const playersList  = $("playersList");
const lobbyHint    = $("lobbyHint");
const msgText      = $("msgText");
const turnPill     = $("turnPill");
const youPill      = $("youPill");
const pileArea     = $("pileArea");
const pileLabel    = $("pileLabel");
const handArea     = $("handArea");
const selectionInfo = $("selectionInfo");
const playBtn      = $("playBtn");
const passBtn      = $("passBtn");
const endPanel     = $("endPanel");
const endTitle     = $("endTitle");
const endDetails   = $("endDetails");
const rankingEl    = $("rankingEl");
const rematchBtn   = $("rematchBtn");
const backLobbyBtn = $("backLobbyBtn");

var state = { you: null, roomCode: null, hostId: null, phase: "lobby", players: [], hand: [], pile: null, turnPlayerId: null, result: null };
var selected = [];

function profile() {
  return { name: (nameInput.value || "").trim().slice(0,18) || "Speler", emoji: emojiSelect.value, color: colorSelect.value };
}

function msg(text, kind) {
  msgText.textContent = text;
  msgText.style.color = kind === "ok" ? "#6ae4a6" : kind === "error" ? "#ff6b6b" : kind === "warn" ? "#ffd166" : "#8a9bb4";
}

function renderPlayers() {
  playersList.innerHTML = "";
  for (var i = 0; i < state.players.length; i++) {
    var p = state.players[i];
    var row = document.createElement("div"); row.className = "pRow";
    var left = document.createElement("div"); left.className = "pLeft";
    var av = document.createElement("div"); av.className = "avatar";
    av.textContent = p.emoji || "🎴";
    av.style.borderColor = (p.color || "#6ae4a6") + "55";
    av.style.background  = (p.color || "#6ae4a6") + "22";
    var nm = document.createElement("div"); nm.className = "pName";
    nm.textContent = p.name + (p.id === state.hostId ? " (host)" : "") + (p.id === (state.you && state.you.id) ? " ←" : "");
    left.appendChild(av); left.appendChild(nm);
    var right = document.createElement("div"); right.className = "pStatus";
    var tags = [];
    if (state.phase === "playing") tags.push(p.cardCount + " kaarten");
    if (p.id === state.turnPlayerId && state.phase === "playing") tags.push("✦ aan beurt");
    right.textContent = tags.join(" · ");
    row.appendChild(left); row.appendChild(right);
    playersList.appendChild(row);
  }
}

function renderPile() {
  // ALTIJD eerst leegmaken — cruciale fix
  pileArea.innerHTML = "";

  if (!state.pile) {
    pileLabel.textContent = "Tafel leeg — startspeler opent de ronde.";
    return;
  }

  pileLabel.textContent = "Op tafel: " + state.pile.count + "x " + state.pile.rank;

  var cards = state.pile.cardsShown || [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var el = document.createElement("div"); el.className = "playCard";
    if (c.suit === "♥" || c.suit === "♦") el.classList.add("red");
    el.innerHTML = '<span class="cRank">' + c.rank + '</span><span class="cSuit">' + c.suit + '</span>';
    pileArea.appendChild(el);
  }
}

function renderHand() {
  handArea.innerHTML = "";
  var sorted = state.hand.slice().sort(function(a,b) { return (b.sort - a.sort) || a.suit.localeCompare(b.suit); });
  for (var i = 0; i < sorted.length; i++) {
    (function(c) {
      var el = document.createElement("div");
      el.className = "handCard" + (selected.indexOf(c.id) !== -1 ? " selected" : "");
      if (c.suit === "♥" || c.suit === "♦") el.classList.add("red");
      el.innerHTML = '<span class="cRank">' + c.rank + '</span><span class="cSuit">' + c.suit + '</span>';
      el.onclick = function() {
        var idx = selected.indexOf(c.id);
        if (idx !== -1) selected.splice(idx, 1); else selected.push(c.id);
        renderHand(); updateButtons();
      };
      handArea.appendChild(el);
    })(sorted[i]);
  }
}

function selSummary() {
  var cards = state.hand.filter(function(c) { return selected.indexOf(c.id) !== -1; });
  if (!cards.length) return "Selecteer kaarten (gelijke waarde).";
  var rank = cards[0].rank;
  for (var i = 0; i < cards.length; i++) if (cards[i].rank !== rank) return "Selecteer alleen kaarten van dezelfde waarde.";
  return cards.length + "x " + rank + " geselecteerd";
}

function updateButtons() {
  selectionInfo.textContent = selSummary();
  var yourTurn = state.phase === "playing" && state.you && state.turnPlayerId === state.you.id;
  playBtn.disabled = !yourTurn || selected.length === 0;
  passBtn.disabled = !yourTurn;
  startBtn.disabled = !(state.phase === "lobby" && state.players.length >= 2 && state.you && state.you.id === state.hostId);
  leaveBtn.disabled = !state.roomCode;
  var turnName = "";
  for (var i = 0; i < state.players.length; i++) if (state.players[i].id === state.turnPlayerId) { turnName = state.players[i].name; break; }
  turnPill.textContent = "Beurt: " + (turnName || "—");
  youPill.textContent  = state.you ? state.you.emoji + " " + state.you.name : "—";
  roomPill.textContent = state.roomCode ? "Kamer: " + state.roomCode : "Nog niet in een kamer";
  if (!state.roomCode) lobbyHint.textContent = "Maak of join een kamer.";
  else if (state.players.length < 2) lobbyHint.textContent = "Wacht op meer spelers (min 2).";
  else if (state.you && state.you.id === state.hostId) lobbyHint.textContent = "Je bent host — je kunt het spel starten.";
  else lobbyHint.textContent = "Wachten tot host start...";
}

function showEnd(result) {
  endPanel.style.display = "block";
  var loser = null;
  if (result && result.ranking) for (var i = 0; i < result.ranking.length; i++) if (result.ranking[i].id === result.loserId) { loser = result.ranking[i]; break; }
  endTitle.textContent   = loser ? "Verliezer: " + loser.name + " 💀" : "Spel klaar!";
  endDetails.textContent = "Iedereen behalve de verliezer heeft zijn kaarten weggespeeld.";
  rankingEl.innerHTML = "";
  if (result && result.ranking) {
    for (var j = 0; j < result.ranking.length; j++) {
      var p = result.ranking[j];
      var line = document.createElement("div");
      line.textContent = (j+1) + ". " + (p.emoji||"🎴") + " " + p.name + (p.id === result.loserId ? " ← verliezer" : "");
      rankingEl.appendChild(line);
    }
  }
  rematchBtn.disabled = !(state.you && state.you.id === state.hostId);
}

function applySnap(snap) {
  state.roomCode     = snap.roomCode;
  state.phase        = snap.phase;
  state.hostId       = snap.hostId;
  state.players      = snap.players || [];
  state.turnPlayerId = snap.turnPlayerId;
  state.hand         = snap.hand    || [];
  state.pile         = snap.pile;    // null = tafel leeg
  state.result       = snap.result;
  renderPlayers();
  renderPile();   // leegt altijd eerst, dan vult indien nodig
  renderHand();
  updateButtons();
  if (state.phase === "ended" && state.result) showEnd(state.result);
  else endPanel.style.display = "none";
}

// URL: ?room=XXXX
(function() {
  var r = new URLSearchParams(window.location.search).get("room");
  if (r) roomInput.value = r.toUpperCase();
})();

createBtn.onclick = function() {
  socket.emit("createRoom", profile(), function(res) {
    if (!res || !res.ok) return msg((res && res.error) || "Kon kamer niet maken.", "error");
    state.you = res.you;
    var url = new URL(window.location.href);
    url.searchParams.set("room", res.roomCode);
    window.history.replaceState({}, "", url.toString());
    msg("Kamer " + res.roomCode + " gemaakt. Deel de link!", "ok");
  });
};

joinBtn.onclick = function() {
  var code = (roomInput.value || "").trim().toUpperCase();
  if (!code) return msg("Vul een kamercode in.", "error");
  socket.emit("joinRoom", { roomCode: code, profile: profile() }, function(res) {
    if (!res || !res.ok) return msg((res && res.error) || "Joinen mislukt.", "error");
    state.you = res.you;
    msg("Joined kamer " + code + ".", "ok");
  });
};

startBtn.onclick = function() {
  socket.emit("startGame", {}, function(res) {
    if (!res || !res.ok) msg((res && res.error) || "Starten mislukt.", "error");
  });
};

leaveBtn.onclick = function() {
  socket.emit("leaveRoom", {}, function() {
    state = { you: null, roomCode: null, hostId: null, phase: "lobby", players: [], hand: [], pile: null, turnPlayerId: null, result: null };
    selected = [];
    renderPlayers(); renderPile(); renderHand(); updateButtons();
    msg("Je hebt de kamer verlaten.", "info");
  });
};

playBtn.onclick = function() {
  var ids = state.hand.filter(function(c) { return selected.indexOf(c.id) !== -1; }).map(function(c) { return c.id; });
  socket.emit("playCards", { cardIds: ids }, function(res) {
    if (!res || !res.ok) return msg((res && res.error) || "Ongeldige zet.", "error");
    selected = [];
    updateButtons();
  });
};

passBtn.onclick = function() {
  socket.emit("pass", {}, function(res) {
    if (!res || !res.ok) msg((res && res.error) || "Passen mislukt.", "error");
  });
};

rematchBtn.onclick   = function() { socket.emit("rematch",      {}, function(res) { if (!res||!res.ok) msg(res&&res.error,"error"); }); };
backLobbyBtn.onclick = function() { socket.emit("backToLobby",  {}, function() {}); };

socket.on("connect",    function() { msg("Verbonden.", "ok"); });
socket.on("disconnect", function() { msg("Verbinding verbroken.", "error"); });
socket.on("roomUpdate", function(snap) { applySnap(snap); });
socket.on("toast",      function(t) { msg(t.text, t.kind); });

msg("Klaar. Maak of join een kamer.");
updateButtons();
