const socket = io();
const $  = id => document.getElementById(id);

const nameInput     = $("nameInput");
const emojiSelect   = $("emojiSelect");
const colorSelect   = $("colorSelect");
const createBtn     = $("createBtn");
const joinBtn       = $("joinBtn");
const roomInput     = $("roomInput");
const startBtn      = $("startBtn");
const leaveBtn      = $("leaveBtn");
const roomPill      = $("roomPill");
const playersList   = $("playersList");
const lobbyHint     = $("lobbyHint");
const msgText       = $("msgText");
const turnPill      = $("turnPill");
const youPill       = $("youPill");
const pileArea      = $("pileArea");
const pileLabel     = $("pileLabel");
const handArea      = $("handArea");
const selectionInfo = $("selectionInfo");
const playBtn       = $("playBtn");
const passBtn       = $("passBtn");
const endPanel      = $("endPanel");
const endTitle      = $("endTitle");
const endDetails    = $("endDetails");
const rankingEl     = $("rankingEl");
const rematchBtn    = $("rematchBtn");
const backLobbyBtn  = $("backLobbyBtn");
const actLogEl      = $("actLog");
const actEmpty      = $("actEmpty");

let state = {
  you:null, roomCode:null, hostId:null, phase:"lobby",
  players:[], hand:[], pile:null, turnPlayerId:null,
  actLog:[], result:null
};
let selected = [];
const shownActIds = new Set();   // voorkomt dubbel renderen van log-items

// ── Helpers ───────────────────────────────────────────────
function profile(){
  return{name:(nameInput.value||"").trim().slice(0,18)||"Speler",emoji:emojiSelect.value,color:colorSelect.value};
}
function msg(text,kind){
  msgText.textContent=text;
  msgText.style.color=kind==="ok"?"#6ae4a6":kind==="error"?"#ff6b6b":kind==="warn"?"#ffd166":"#8a9bb4";
}
function makeCard(rank,suit,mini){
  const el=document.createElement("div");
  el.className=mini?"act-mini-card":"playCard";
  if(suit==="♥"||suit==="♦") el.classList.add("red");
  el.innerHTML=`<span class="cRank">${rank}</span><span class="cSuit">${suit}</span>`;
  return el;
}

// ── Spelerlijst ───────────────────────────────────────────
function renderPlayers(){
  playersList.innerHTML="";
  for(const p of state.players){
    const row=document.createElement("div");
    row.className="pRow"
      +(p.isGhost?" ghost-row":"")
      +(p.id===state.turnPlayerId&&state.phase==="playing"?" my-turn":"");
    const left=document.createElement("div"); left.className="pLeft";
    const av=document.createElement("div");   av.className="avatar";
    av.textContent=p.emoji||"🎴";
    av.style.borderColor=(p.color||"#6ae4a6")+"55";
    av.style.background =(p.color||"#6ae4a6")+"22";
    const nm=document.createElement("div");   nm.className="pName";
    let label=p.isGhost?"🤖 Computer (past altijd)":p.name;
    if(!p.isGhost&&p.id===state.hostId)              label+=" (host)";
    if(!p.isGhost&&p.id===(state.you&&state.you.id)) label+=" ←";
    nm.textContent=label;
    left.append(av,nm);
    const right=document.createElement("div"); right.className="pStatus";
    const tags=[];
    if(state.phase==="playing") tags.push(p.cardCount+" kaarten");
    if(p.id===state.turnPlayerId&&state.phase==="playing") tags.push("✦ beurt");
    right.textContent=tags.join(" · ");
    row.append(left,right);
    playersList.appendChild(row);
  }
}

// ── Tafel ─────────────────────────────────────────────────
function renderPile(){
  pileArea.innerHTML="";
  if(!state.pile){
    pileLabel.textContent="Tafel leeg — startspeler opent de ronde.";
    return;
  }
  pileLabel.textContent="Op tafel: "+state.pile.count+"x "+state.pile.rank;
  for(const c of (state.pile.cardsShown||[])) pileArea.appendChild(makeCard(c.rank,c.suit,false));
}

// ── Hand ──────────────────────────────────────────────────
function renderHand(){
  handArea.innerHTML="";
  const sorted=state.hand.slice().sort((a,b)=>(b.sort-a.sort)||a.suit.localeCompare(b.suit));
  for(const c of sorted){
    const el=document.createElement("div");
    el.className="handCard"+(selected.includes(c.id)?" selected":"");
    if(c.suit==="♥"||c.suit==="♦") el.classList.add("red");
    el.innerHTML=`<span class="cRank">${c.rank}</span><span class="cSuit">${c.suit}</span>`;
    el.onclick=()=>{
      const i=selected.indexOf(c.id);
      if(i!==-1) selected.splice(i,1); else selected.push(c.id);
      renderHand(); updateButtons();
    };
    handArea.appendChild(el);
  }
}

// ── Activiteitenlog ───────────────────────────────────────
function renderActLog(){
  const items=state.actLog||[];
  actEmpty.style.display=items.length?"none":"block";

  for(const act of items){
    if(shownActIds.has(act.id)) continue;
    shownActIds.add(act.id);

    const el=document.createElement("div");
    el.className="act-item type-"+act.type;

    // Avatar
    const av=document.createElement("div"); av.className="act-avatar";
    av.textContent=act.emoji||"🎴";
    av.style.background=(act.color||"#556070")+"30";
    av.style.borderColor=(act.color||"#556070")+"60";

    // Body
    const body=document.createElement("div"); body.className="act-body";
    const nm=document.createElement("div");   nm.className="act-name";
    nm.textContent=act.playerName;
    const desc=document.createElement("div"); desc.className="act-desc";
    if(act.type==="play")  desc.textContent="speelde "+act.count+"× "+act.rank;
    else if(act.type==="pass") desc.textContent="paste";
    else if(act.type==="win")  desc.textContent="🏆 wint de ronde!";
    body.append(nm,desc);

    // Mini-kaartjes tonen bij 'play'
    if(act.type==="play"&&act.cards&&act.cards.length){
      const cardRow=document.createElement("div"); cardRow.className="act-cards";
      for(const c of act.cards) cardRow.appendChild(makeCard(c.rank,c.suit,true));
      body.appendChild(cardRow);
    }

    el.append(av,body);
    // Nieuwste bovenaan
    actLogEl.insertBefore(el,actLogEl.firstChild);

    // Fade na 4 seconden
    setTimeout(()=>{
      el.classList.add("fading");
      setTimeout(()=>{ if(el.parentNode) el.remove(); },600);
    },4000);
  }
}

// ── Knoppen & pills ───────────────────────────────────────
function selSummary(){
  const cards=state.hand.filter(c=>selected.includes(c.id));
  if(!cards.length) return "Selecteer kaarten (gelijke waarde).";
  const rank=cards[0].rank;
  for(const c of cards) if(c.rank!==rank) return "Selecteer alleen kaarten van dezelfde waarde.";
  return cards.length+"× "+rank+" geselecteerd";
}
function updateButtons(){
  selectionInfo.textContent=selSummary();
  const yourTurn=state.phase==="playing"&&state.you&&state.turnPlayerId===state.you.id;
  playBtn.disabled=!yourTurn||!selected.length;
  passBtn.disabled=!yourTurn;
  const realCount=state.players.filter(p=>!p.isGhost).length;
  startBtn.disabled=!(state.phase==="lobby"&&realCount>=2&&state.you&&state.you.id===state.hostId);
  leaveBtn.disabled=!state.roomCode;
  const turnP=state.players.find(p=>p.id===state.turnPlayerId);
  turnPill.textContent="Beurt: "+(turnP?turnP.name:"—");
  youPill.textContent =state.you?state.you.emoji+" "+state.you.name:"—";
  roomPill.textContent=state.roomCode?"Kamer: "+state.roomCode:"Nog niet in een kamer";
  if(!state.roomCode)                              lobbyHint.textContent="Maak of join een kamer.";
  else if(realCount<2)                             lobbyHint.textContent="Wacht op meer spelers (min 2).";
  else if(state.you&&state.you.id===state.hostId)  lobbyHint.textContent="Je bent host — start het spel!";
  else                                             lobbyHint.textContent="Wachten tot host start...";
}

// ── Eindscherm ────────────────────────────────────────────
function showEnd(result){
  endPanel.style.display="block";
  const loser=result&&result.ranking?result.ranking.find(p=>p.id===result.loserId):null;
  endTitle.textContent   =loser?"Verliezer: "+loser.name+" 💀":"Spel klaar!";
  endDetails.textContent ="Iedereen behalve de verliezer heeft zijn kaarten weggespeeld.";
  rankingEl.innerHTML="";
  if(result&&result.ranking){
    result.ranking.forEach((p,i)=>{
      const line=document.createElement("div");
      line.textContent=(i+1)+". "+(p.emoji||"🎴")+" "+p.name+(p.id===result.loserId?" ← verliezer":"");
      rankingEl.appendChild(line);
    });
  }
  rematchBtn.disabled=!(state.you&&state.you.id===state.hostId);
}

// ── Hoofd-update ──────────────────────────────────────────
function applySnap(snap){
  state.roomCode    =snap.roomCode;
  state.phase       =snap.phase;
  state.hostId      =snap.hostId;
  state.players     =snap.players||[];
  state.turnPlayerId=snap.turnPlayerId;
  state.hand        =snap.hand||[];
  state.pile        =snap.pile;
  state.actLog      =snap.actLog||[];
  state.result      =snap.result;
  renderPlayers();
  renderPile();
  renderHand();
  renderActLog();
  updateButtons();
  if(state.phase==="ended"&&state.result) showEnd(state.result);
  else endPanel.style.display="none";
}

// ── URL ?room=XXXX ────────────────────────────────────────
(()=>{
  const r=new URLSearchParams(location.search).get("room");
  if(r) roomInput.value=r.toUpperCase();
})();

// ── Button handlers ───────────────────────────────────────
createBtn.onclick=()=>{
  socket.emit("createRoom",profile(),res=>{
    if(!res||!res.ok) return msg((res&&res.error)||"Kon kamer niet maken.","error");
    state.you=res.you;
    const url=new URL(location.href);
    url.searchParams.set("room",res.roomCode);
    history.replaceState({},"",url.toString());
    msg("Kamer "+res.roomCode+" gemaakt. Deel de link!","ok");
  });
};
joinBtn.onclick=()=>{
  const code=(roomInput.value||"").trim().toUpperCase();
  if(!code) return msg("Vul een kamercode in.","error");
  socket.emit("joinRoom",{roomCode:code,profile:profile()},res=>{
    if(!res||!res.ok) return msg((res&&res.error)||"Joinen mislukt.","error");
    state.you=res.you;
    msg("Joined kamer "+code+".","ok");
  });
};
startBtn.onclick  =()=>socket.emit("startGame",  {},res=>{if(!res||!res.ok) msg(res&&res.error,"error");});
leaveBtn.onclick  =()=>{
  socket.emit("leaveRoom",{},()=>{
    state={you:null,roomCode:null,hostId:null,phase:"lobby",players:[],hand:[],pile:null,turnPlayerId:null,actLog:[],result:null};
    selected=[];shownActIds.clear();
    renderPlayers();renderPile();renderHand();
    actLogEl.innerHTML="";actEmpty.style.display="block";
    updateButtons();msg("Je hebt de kamer verlaten.","info");
  });
};
playBtn.onclick=()=>{
  const ids=state.hand.filter(c=>selected.includes(c.id)).map(c=>c.id);
  socket.emit("playCards",{cardIds:ids},res=>{
    if(!res||!res.ok) return msg((res&&res.error)||"Ongeldige zet.","error");
    selected=[];updateButtons();
  });
};
passBtn.onclick     =()=>socket.emit("pass",       {},res=>{if(!res||!res.ok) msg(res&&res.error,"error");});
rematchBtn.onclick  =()=>socket.emit("rematch",    {},res=>{if(!res||!res.ok) msg(res&&res.error,"error");});
backLobbyBtn.onclick=()=>socket.emit("backToLobby",{},()=>{});

socket.on("connect",   ()=>msg("Verbonden.","ok"));
socket.on("disconnect",()=>msg("Verbinding verbroken.","error"));
socket.on("roomUpdate",snap=>applySnap(snap));
socket.on("toast",     t=>msg(t.text,t.kind));

msg("Klaar. Maak of join een kamer.");
updateButtons();
