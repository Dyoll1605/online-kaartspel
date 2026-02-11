/* client.js
   Regelt: lobby-flow, room join/create, UI render, kaartselectie, en realtime updates via Socket.IO.
*/

const socket = io();

const $ = (id) => document.getElementById(id);

const nameInput = $("nameInput");
const emojiSelect = $("emojiSelect");
const colorSelect = $("colorSelect");
const createBtn = $("createBtn");
const joinBtn = $("joinBtn");
const roomInput = $("roomInput");
const startBtn = $("startBtn");
const leaveBtn = $("leaveBtn");

const lobbyPanel = $("lobbyPanel");
const gameSidePanel = $("gameSidePanel");
const lobbyHint = $("lobbyHint");
const roomPill = $("roomPill");
const gameRoomPill = $("gameRoomPill");
const playersList = $("playersList");
const playersListGame = $("playersListGame");

const screenTitle = $("screenTitle");
const screenSub = $("screenSub");
const youPill = $("youPill");
const turnPill = $("turnPill");
const turnBadge = $("turnBadge");

const msgText = $("msgText");
const netText = $("netText");

const lobbyUIHelp = $("lobbyUIHelp");
const gameUI = $("gameUI");

const pileArea = $("pileArea");
const handArea = $("handArea");

const playBtn = $("playBtn");
const passBtn = $("passBtn");
const drawBtn = $("drawBtn");

const selectionInfo = $("selectionInfo");

const rulesBtn = $("rulesBtn");
const menuBtn = $("menuBtn");
const modalBackdrop = $("modalBackdrop");
const closeRulesBtn = $("closeRulesBtn");

const endPanel = $("endPanel");
const endTitle = $("endTitle");
const endDetails = $("endDetails");
const rematchBtn = $("rematchBtn");
const backLobbyBtn = $("backLobbyBtn");

let state = {
  connected: false,
  roomCode: null,
  you: null,               // {id,name,emoji,color}
  phase: "lobby",          // "lobby" | "playing" | "ended"
  players: [],             // from server (public info)
  hand: [],                // your private hand
  pile: null,              // {rank,count,cardsShown, lastPlayedBy, passes}
  turnPlayerId: null,
  hostId: null,
  isHost: false,
  winner: null,
  canRematch: false
};

let selectedCardIds = new Set();

function getProfile() {
  const name = (nameInput.value || "").trim().slice(0, 18) || "Speler";
  const emoji = emojiSelect.value || "🦊";
  const color = colorSelect.value || "#6ae4a6";
  return { name, emoji, color };
}

function setMessage(text, kind = "info") {
  // kind is currently cosmetic; keep it simple and readable
  msgText.textContent = text;
  if (kind === "error") msgText.style.color = "var(--danger)";
  else if (kind === "ok") msgText.style.color = "var(--ok)";
  else if (kind === "warn") msgText.style.color = "var(--warn)";
  else msgText.style.color = "var(--muted)";
}

function updateTop() {
  netText.textContent = state.connected ? "Online" : "Offline";
  roomPill.textContent = state.roomCode ? `Kamer: ${state.roomCode}` : "Nog niet in een kamer";
  gameRoomPill.textContent = state.roomCode ? `Kamer: ${state.roomCode}` : "Kamer: -";

  const youLabel = state.you ? `${state.you.emoji} ${state.you.name}` : "-";
  youPill.textContent = `Jij: ${youLabel}`;

  const turnName = state.players.find(p => p.id === state.turnPlayerId)?.name || "-";
  turnPill.textContent = `Beurt: ${turnName}`;
  turnBadge.textContent = state.turnPlayerId === state.you?.id ? "Jij bent aan de beurt" : `Aan de beurt: ${turnName}`;

  startBtn.disabled = !(state.isHost && state.phase === "lobby" && state.players.length >= 2);
  leaveBtn.disabled = !state.roomCode;
}

function renderPlayers(listEl) {
  listEl.innerHTML = "";
  if (!state.players.length) return;

  for (const p of state.players) {
    const row = document.createElement("div");
    row.className = "pRow";

    const left = document.createElement("div");
    left.className = "pLeft";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = p.emoji || "🎴";
    av.style.borderColor = (p.color || "#6ae4a6") + "66";
    av.style.background = (p.color || "#6ae4a6") + "22";

    const nm = document.createElement("div");
    nm.className = "pName";
    nm.textContent = p.name + (p.id === state.hostId ? " (host)" : "") + (p.isBot ? " (dummy)" : "");

    left.appendChild(av);
    left.appendChild(nm);

    const st = document.createElement("div");
    st.className = "status";
    const flags = [];
    if (p.id === state.turnPlayerId && state.phase !== "lobby") flags.push("aan beurt");
    if (p.id === state.you?.id) flags.push("jij");
    if (state.phase !== "lobby") flags.push(`${p.cardCount ?? 0} kaarten`);
    st.textContent = flags.join(" · ") || "";

    row.appendChild(left);
    row.appendChild(st);

    listEl.appendChild(row);
  }
}

function showLobby() {
  state.phase = "lobby";
  lobbyUIHelp.classList.remove("hidden");
  gameUI.classList.add("hidden");
  lobbyPanel.classList.remove("hidden");
  gameSidePanel.classList.add("hidden");
  screenTitle.textContent = "Lobby";
  screenSub.textContent = "Wachten op spelers…";
  endPanel.classList.add("hidden");
  updateTop();
}

function showGame() {
  lobbyUIHelp.classList.add("hidden");
  gameUI.classList.remove("hidden");
  lobbyPanel.classList.add("hidden");
  gameSidePanel.classList.remove("hidden");
  screenTitle.textContent = "Aan tafel";
  screenSub.textContent = "Speel realtime met je kamer.";
  updateTop();
}

function showEnd() {
  endPanel.classList.remove("hidden");
  rematchBtn.disabled = !(state.isHost && state.canRematch);
}

function clearSelection() {
  selectedCardIds.clear();
}

function selectionSummary() {
  const sel = state.hand.filter(c => selectedCardIds.has(c.id));
  if (!sel.length) return "Selecteer kaarten om te spelen.";
  const ranks = new Set(sel.map(c => c.rank));
  if (ranks.size > 1) return `⚠️ ${sel.length} kaarten geselecteerd (meerdere waarden). Alleen sets met gelijke waarde.`;
  const rank = sel[0].rank;
  return `${sel.length}× ${rank} geselecteerd`;
}

/* UI: hand */
function renderHand() {
  handArea.innerHTML = "";

  const sorted = [...state.hand].sort((a, b) => (b.sort - a.sort) || a.suit.localeCompare(b.suit));
  for (const c of sorted) {
    const el = document.createElement("div");
    el.className = "hCard";
    if (selectedCardIds.has(c.id)) el.classList.add("selected");
    el.dataset.id = c.id;

    el.innerHTML = `
      <div class="v">${c.rank}</div>
      <div class="s">${c.suit}</div>
    `;

    el.addEventListener("click", () => {
      if (selectedCardIds.has(c.id)) selectedCardIds.delete(c.id);
      else selectedCardIds.add(c.id);
      renderHand();
      selectionInfo.textContent = selectionSummary();
      updateActionButtons();
    });

    handArea.appendChild(el);
  }
}

/* UI: pile */
function renderPile() {
  pileArea.innerHTML = "";
  const pile = state.pile;

  if (!pile || !pile.cardsShown?.length) {
    const t = document.createElement("div");
    t.className = "tiny";
    t.textContent = "Nog geen kaarten gespeeld. Start een slag.";
    pileArea.appendChild(t);
    return;
  }

  for (const shown of pile.cardsShown) {
    const el = document.createElement("div");
    el.className = "cardMini";
    el.innerHTML = `<div class="v">${shown.rank}</div><div class="s">${shown.suit}</div>`;
    pileArea.appendChild(el);
  }
}

/* Enable/disable play/pass based on server state + your selection */
function updateActionButtons() {
  const yourTurn = state.turnPlayerId && state.you && state.turnPlayerId === state.you.id;
  const ended = state.phase === "ended";

  if (!yourTurn || ended) {
    playBtn.disabled = true;
    passBtn.disabled = true;
    return;
  }

  // Pass is always allowed on your turn while playing.
  passBtn.disabled = false;

  // Play is allowed if selection is non-empty (server validates for real).
  const selCount = selectedCardIds.size;
  playBtn.disabled = selCount === 0;

  // Tiny hint
  selectionInfo.textContent = selectionSummary();
}

function updateLobbyHint() {
  if (!state.roomCode) {
    lobbyHint.textContent = "Maak een kamer of join met een code.";
    return;
  }
  if (state.players.length < 2) lobbyHint.textContent = "Wachten op andere spelers… (minstens 2 nodig)";
  else if (state.isHost) lobbyHint.textContent = "Je bent host. Je kunt het spel starten.";
  else lobbyHint.textContent = "Wachten tot host het spel start…";
}

function applyServerSnapshot(snap) {
  // Snap is compact and comes from server
  state.roomCode = snap.roomCode ?? state.roomCode;
  state.phase = snap.phase ?? state.phase;
  state.players = snap.players ?? state.players;
  state.hostId = snap.hostId ?? state.hostId;
  state.turnPlayerId = snap.turnPlayerId ?? state.turnPlayerId;
  state.pile = snap.pile ?? state.pile;
  state.winner = snap.winner ?? null;
  state.canRematch = !!snap.canRematch;

  // personal hand
  if (snap.hand) state.hand = snap.hand;

  state.isHost = state.you && state.hostId === state.you.id;

  updateTop();
  updateLobbyHint();
  renderPlayers(playersList);
  renderPlayers(playersListGame);
  renderPile();
  renderHand();

  // Screen switching
  if (state.phase === "lobby") showLobby();
  if (state.phase === "playing") showGame();
  if (state.phase === "ended") {
    showGame();
    endTitle.textContent = state.winner ? `${state.winner.name} heeft gewonnen!` : "Einde";
    endDetails.textContent = snap.endReason || "Spel afgelopen.";
    showEnd();
  }

  updateActionButtons();
}

/* URL room auto-join */
function readRoomFromURL() {
  const url = new URL(window.location.href);
  const room = url.searchParams.get("room");
  if (room) {
    roomInput.value = room.toUpperCase().slice(0, 6);
  }
}

function setURLRoom(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  window.history.replaceState({}, "", url.toString());
}

/* --- Socket events --- */
socket.on("connect", () => {
  state.connected = true;
  setMessage("Verbonden. Kies een kamer.", "ok");
  updateTop();
});

socket.on("disconnect", () => {
  state.connected = false;
  setMessage("Verbinding verbroken. Refresh indien nodig.", "error");
  updateTop();
});

socket.on("roomUpdate", (snap) => {
  applyServerSnapshot(snap);
});

socket.on("toast", ({ text, kind }) => {
  setMessage(text, kind || "info");
});

socket.on("kicked", ({ reason }) => {
  setMessage(reason || "Je bent uit de kamer gehaald.", "warn");
  // Reset local
  state.roomCode = null;
  state.phase = "lobby";
  state.players = [];
  state.hand = [];
  state.pile = null;
  state.turnPlayerId = null;
  state.hostId = null;
  state.isHost = false;
  setURLRoom("");
  showLobby();
});

/* --- Button handlers --- */
createBtn.addEventListener("click", () => {
  const profile = getProfile();
  socket.emit("createRoom", profile, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || "Kon kamer niet maken.", "error");
      return;
    }
    state.you = res.you;
    setURLRoom(res.roomCode);
    setMessage(`Kamer ${res.roomCode} aangemaakt. Deel de link/code.`, "ok");
  });
});

joinBtn.addEventListener("click", () => {
  const code = (roomInput.value || "").trim().toUpperCase();
  if (!code) return setMessage("Vul een kamercode in.", "warn");

  const profile = getProfile();
  socket.emit("joinRoom", { roomCode: code, profile }, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || "Join mislukt.", "error");
      return;
    }
    state.you = res.you;
    setURLRoom(code);
    setMessage(`Joined kamer ${code}.`, "ok");
  });
});

startBtn.addEventListener("click", () => {
  socket.emit("startGame", {}, (res) => {
    if (!res?.ok) setMessage(res?.error || "Kon spel niet starten.", "error");
  });
});

leaveBtn.addEventListener("click", () => {
  socket.emit("leaveRoom", {}, () => {});
  setMessage("Je hebt de kamer verlaten.", "info");

  // local reset
  state.roomCode = null;
  state.phase = "lobby";
  state.players = [];
  state.hand = [];
  state.pile = null;
  state.turnPlayerId = null;
  state.hostId = null;
  state.isHost = false;
  clearSelection();
  setURLRoom("");
  showLobby();
});

menuBtn.addEventListener("click", () => {
  // Go back to lobby state (but remain in room). Useful if someone wants to stop.
  socket.emit("backToLobby", {}, (res) => {
    if (!res?.ok) setMessage(res?.error || "Kon niet terug naar lobby.", "error");
  });
});

playBtn.addEventListener("click", () => {
  const cards = state.hand.filter(c => selectedCardIds.has(c.id)).map(c => c.id);
  socket.emit("playCards", { cardIds: cards }, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || "Ongeldige zet.", "error");
      return;
    }
    clearSelection();
    renderHand();
    selectionInfo.textContent = selectionSummary();
    updateActionButtons();
  });
});

passBtn.addEventListener("click", () => {
  socket.emit("pass", {}, (res) => {
    if (!res?.ok) setMessage(res?.error || "Kon niet passen.", "error");
  });
});

/* Rules modal */
rulesBtn?.addEventListener("click", () => modalBackdrop.style.display = "flex");
closeRulesBtn?.addEventListener("click", () => modalBackdrop.style.display = "none");
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) modalBackdrop.style.display = "none";
});

/* End screen */
rematchBtn.addEventListener("click", () => {
  socket.emit("rematch", {}, (res) => {
    if (!res?.ok) setMessage(res?.error || "Kon geen rematch starten.", "error");
  });
});

backLobbyBtn.addEventListener("click", () => {
  socket.emit("backToLobby", {}, () => {});
});

/* Init */
readRoomFromURL();
setMessage("Kies een naam, maak een kamer of join via code.", "info");
showLobby();
