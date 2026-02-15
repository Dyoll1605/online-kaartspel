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
const modeBadge     = $("modeBadge");
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
const backLobbyBtn  = $("backLobbyBtn");
const actLogEl      = $("actLog");
const actEmpty      = $("actEmpty");
const swapPanel     = $("swapPanel");
const swapDesc      = $("swapDesc");
const swapDetails   = $("swapDetails");
const modePanel     = $("modePanel");
const modeDesc      = $("modeDesc");
const modeBtns      = $("modeBtns");

const MODE_INFO = {
  traditioneel:  {label:"Traditioneel",  icon:"🃏", desc:"Speel hoger of pas. Laatste met kaarten verliest."},
  aanleggen:     {label:"Aanleggen",      icon:"📥", desc:"Leg extra kaarten van dezelfde waarde aan of speel hoger."},
  kleurbekennen: {label:"Kleur bekennen", icon:"🎨", desc:"Aanleggen + kleurplicht: volg de kleurverdeling op tafel."},
};

let state = {
  you:null, roomCode:null, hostId:null, phase:"lobby", gameMode:"traditioneel",
  players:[], hand:[], pile:null, turnPlayerId:null,
  actLog:[], result:null, swapState:null, modeOptions:null,
};
let selected = [];
const shownActIds = new Set();

// ── Helpers ──────────────────────────────────────────────────────
function profile(){
  return{name:(nameInput.value||"").trim().slice(0,18)||"Speler",
         emoji:emojiSelect.value,color:colorSelect.value};
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
function makeHandCard(c, isSelected){
  const el=document.createElement("div");
  el.className="handCard"+(isSelected?" selected":"");
  if(c.suit==="♥"||c.suit==="♦") el.classList.add("red");
  el.innerHTML=`<span class="cRank">${c.rank}</span><span class="cSuit">${c.suit}</span>`;
  return el;
}

// ── Spelerlijst ──────────────────────────────────────────────────
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
    if(!p.isGhost&&p.id===state.hostId)               label+=" (host)";
    if(!p.isGhost&&p.id===(state.you&&state.you.id))  label+=" ←";
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

// ── Tafel ────────────────────────────────────────────────────────
function renderPile(){
  pileArea.innerHTML="";
  if(!state.pile){
    pileLabel.textContent="Tafel leeg — startspeler opent de ronde.";
    return;
  }
  pileLabel.textContent="Op tafel: "+state.pile.count+"× "+state.pile.rank;
  for(const c of (state.pile.cardsShown||[])) pileArea.appendChild(makeCard(c.rank,c.suit,false));
}

// ── Hand ─────────────────────────────────────────────────────────
function renderHand(){
  handArea.innerHTML="";
  const sorted=state.hand.slice().sort((a,b)=>(b.sort-a.sort)||a.suit.localeCompare(b.suit));
  for(const c of sorted){
    const el=makeHandCard(c,selected.includes(c.id));
    el.onclick=()=>{
      const i=selected.indexOf(c.id);
      if(i!==-1) selected.splice(i,1); else selected.push(c.id);
      renderHand(); updateButtons();
    };
    handArea.appendChild(el);
  }
}

// ── Swap-fase ────────────────────────────────────────────────────
function renderSwap(swapState){
  if(!swapState||!swapState.done){ swapPanel.style.display="none"; return; }
  swapPanel.style.display="block";
  const winner=state.players.find(p=>p.id===swapState.winnerId);
  const loser =state.players.find(p=>p.id===swapState.loserId);
  swapDesc.textContent=
    (winner?winner.name:"Winnaar")+" geeft "+swapState.winnerGives.length+"× laagste aan "+
    (loser?loser.name:"Verliezer")+
    " · "+(loser?loser.name:"Verliezer")+" geeft "+swapState.loserGives.length+"× hoogste aan "+
    (winner?winner.name:"Winnaar");
  swapDetails.innerHTML="";

  function makeSwapBox(title,cards){
    const box=document.createElement("div"); box.className="swap-box";
    const h=document.createElement("h2"); h.textContent=title;
    const row=document.createElement("div"); row.className="swap-cards";
    for(const c of cards) row.appendChild(makeCard(c.rank,c.suit,false));
    box.append(h,row);
    return box;
  }
  swapDetails.appendChild(makeSwapBox((winner?winner.name:"Winnaar")+" geeft laagste:",swapState.winnerGives));
  swapDetails.appendChild(makeSwapBox((loser?loser.name:"Verliezer")+" geeft hoogste:",swapState.loserGives));
}

// ── Modus-selectie ────────────────────────────────────────────────
function renderModeSelect(options){
  if(!options||state.phase!=="modeSelect"){ modePanel.style.display="none"; return; }
  modePanel.style.display="block";
  const isWinner=state.result&&state.you&&state.you.id===state.result.winnerId;
  const winner=state.players.find(p=>p.id===(state.result&&state.result.winnerId));
  modeDesc.textContent=isWinner
    ?"Jij wint! Kies welke variant jullie het volgende potje spelen:"
    :"Wachten op "+(winner?winner.name:"de winnaar")+"...";
  modeBtns.innerHTML="";
  if(!isWinner) return;
  for(const opt of options){
    const info=MODE_INFO[opt.key]||{label:opt.label,icon:opt.icon,desc:""};
    const btn=document.createElement("button");
    btn.className="mode-btn";
    btn.innerHTML=`<span class="mode-icon">${info.icon}</span><span class="mode-name">${info.label}</span><span class="mode-desc">${info.desc}</span>`;
    btn.onclick=()=>{
      socket.emit("selectMode",{mode:opt.key},res=>{
        if(!res||!res.ok) msg(res&&res.error,"error");
      });
    };
    modeBtns.appendChild(btn);
  }
}

// ── Activiteitenlog ───────────────────────────────────────────────
function renderActLog(){
  const items=state.actLog||[];
  actEmpty.style.display=items.length?"none":"block";
  for(const act of items){
    if(shownActIds.has(act.id)) continue;
    shownActIds.add(act.id);
    const el=document.createElement("div");
    const typeClass=act.isAppend?"append":act.type;
    el.className="act-item type-"+typeClass;
    const av=document.createElement("div"); av.className="act-avatar";
    av.textContent=act.emoji||"🎴";
    av.style.background=(act.color||"#556070")+"30";
    av.style.borderColor=(act.color||"#556070")+"60";
    const body=document.createElement("div"); body.className="act-body";
    const nm=document.createElement("div");   nm.className="act-name";
    nm.textContent=act.playerName;
    const desc=document.createElement("div"); desc.className="act-desc";
    if(act.type==="play")
      desc.textContent=(act.isAppend?"legde aan: ":"speelde ")+act.count+"× "+act.rank;
    else if(act.type==="pass") desc.textContent="paste";
    else if(act.type==="win")  desc.textContent="🏆 wint de ronde!";
    body.append(nm,desc);
    if(act.type==="play"&&act.cards&&act.cards.length){
      const cr=document.createElement("div"); cr.className="act-cards";
      for(const c of act.cards) cr.appendChild(makeCard(c.rank,c.suit,true));
      body.appendChild(cr);
    }
    el.append(av,body);
    actLogEl.insertBefore(el,actLogEl.firstChild);
    setTimeout(()=>{
      el.classList.add("fading");
      setTimeout(()=>{ if(el.parentNode) el.remove(); },600);
    },4000);
  }
}

// ── Knoppen & pills ───────────────────────────────────────────────
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
  // Mode badge
  const mi=MODE_INFO[state.gameMode];
  if(mi&&state.phase==="playing"){
    modeBadge.style.display="inline-flex";
    modeBadge.textContent=mi.icon+" "+mi.label;
  } else { modeBadge.style.display="none"; }
  if(!state.roomCode)                              lobbyHint.textContent="Maak of join een kamer.";
  else if(realCount<2)                             lobbyHint.textContent="Wacht op meer spelers (min 2).";
  else if(state.you&&state.you.id===state.hostId)  lobbyHint.textContent="Je bent host — start het spel!";
  else                                             lobbyHint.textContent="Wachten tot host start...";
}

// ── Eindscherm ────────────────────────────────────────────────────
function renderEnd(result){
  if(!result||state.phase==="playing"||state.phase==="swap"||state.phase==="modeSelect"){
    endPanel.style.display="none"; return;
  }
  // Eindscherm toont ranking maar daarna volgt swap/modeSelect — toon het dus niet apart
  endPanel.style.display="none";
}

// ── Hoofd-update ──────────────────────────────────────────────────
function applySnap(snap){
  state.roomCode    =snap.roomCode;
  state.phase       =snap.phase;
  state.hostId      =snap.hostId;
  state.gameMode    =snap.gameMode||"traditioneel";
  state.players     =snap.players||[];
  state.turnPlayerId=snap.turnPlayerId;
  state.hand        =snap.hand||[];
  state.pile        =snap.pile;
  state.actLog      =snap.actLog||[];
  state.result      =snap.result;
  state.swapState   =snap.swapState;
  state.modeOptions =snap.modeOptions;

  renderPlayers();
  renderPile();
  renderHand();
  renderActLog();
  updateButtons();

  // Panels tonen op basis van fase
  swapPanel.style.display   = state.phase==="swap"       ? "block" : "none";
  modePanel.style.display   = state.phase==="modeSelect" ? "block" : "none";
  endPanel.style.display    = "none";

  if(state.phase==="swap")        renderSwap(state.swapState);
  if(state.phase==="modeSelect")  renderModeSelect(state.modeOptions);
}

// ── URL ?room=XXXX ────────────────────────────────────────────────
(()=>{
  const r=new URLSearchParams(location.search).get("room");
  if(r) roomInput.value=r.toUpperCase();
})();

// ── Event handlers ────────────────────────────────────────────────
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
    state={you:null,roomCode:null,hostId:null,phase:"lobby",gameMode:"traditioneel",
           players:[],hand:[],pile:null,turnPlayerId:null,actLog:[],result:null,
           swapState:null,modeOptions:null};
    selected=[];shownActIds.clear();
    renderPlayers();renderPile();renderHand();
    actLogEl.innerHTML="";actEmpty.style.display="block";
    swapPanel.style.display="none";modePanel.style.display="none";endPanel.style.display="none";
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
backLobbyBtn.onclick=()=>socket.emit("backToLobby",{},()=>{});

socket.on("connect",   ()=>msg("Verbonden.","ok"));
socket.on("disconnect",()=>msg("Verbinding verbroken.","error"));
socket.on("roomUpdate",snap=>applySnap(snap));
socket.on("toast",     t=>msg(t.text,t.kind));

msg("Klaar. Maak of join een kamer.");
updateButtons();
