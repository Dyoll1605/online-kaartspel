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
const swapOverlay   = $("swapOverlay");
const swapPanel     = $("swapPanel");
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
  console.log("renderSwap called:", swapState);
  if(!swapState){ swapOverlay.className=""; return; }

  const wName  = swapState.winnerName  || "Winnaar";
  const wEmoji = swapState.winnerEmoji || "🏆";
  const lName  = swapState.loserName   || "Verliezer";
  const lEmoji = swapState.loserEmoji  || "💀";
  const sLeft  = swapState.secondsLeft != null ? swapState.secondsLeft : 10;

  // Bouw de popup opnieuw op
  swapPanel.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px";
  const title = document.createElement("div");
  title.innerHTML = "<h1 style='color:#ffd166;font-size:20px'>🔄 Kaartruil</h1>";
  const timer = document.createElement("div");
  timer.style.cssText = "font-size:28px;font-weight:800;color:#ffd166;min-width:32px;text-align:right";
  timer.textContent = sLeft;
  header.append(title, timer);
  swapPanel.appendChild(header);

  // Uitleg
  const uitleg = document.createElement("p");
  uitleg.style.cssText = "font-size:12px;color:#8a9bb4;margin-bottom:16px;line-height:1.5";
  uitleg.textContent =
    lEmoji+" "+lName+" (verliezer) geeft zijn 2 hoogste kaarten aan "+wName+
    ". "+wEmoji+" "+wName+" (winnaar) geeft zijn 2 laagste kaarten aan "+lName+".";
  swapPanel.appendChild(uitleg);

  // Twee ruil-blokken
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:12px;flex-wrap:wrap";

  function makeSwapBlock(fromEmoji, fromName, toEmoji, toName, label, cards){
    const box = document.createElement("div");
    box.style.cssText = "flex:1;min-width:140px;padding:12px;border:1px solid rgba(255,213,102,.25);border-radius:12px;background:rgba(255,213,102,.07)";

    const lbl = document.createElement("div");
    lbl.style.cssText = "font-size:11px;color:#8a9bb4;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em";
    lbl.textContent = label;

    const who = document.createElement("div");
    who.style.cssText = "font-size:13px;font-weight:700;margin-bottom:10px;color:#e8eef6";
    who.textContent = fromEmoji+" "+fromName+" → "+toEmoji+" "+toName;

    const cardRow = document.createElement("div");
    cardRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    for(const c of (cards||[])) cardRow.appendChild(makeCard(c.rank, c.suit, false));
    if(!cards||!cards.length){
      const none = document.createElement("span");
      none.style.cssText = "font-size:12px;color:#556070";
      none.textContent = "—";
      cardRow.appendChild(none);
    }
    box.append(lbl, who, cardRow);
    return box;
  }

  // Verliezer geeft 2 hoogste aan winnaar (eerst tonen)
  row.appendChild(makeSwapBlock(
    lEmoji, lName, wEmoji, wName,
    "Verliezer geeft 2 hoogste aan winnaar",
    swapState.loserGives
  ));

  // Winnaar geeft 2 laagste aan verliezer
  row.appendChild(makeSwapBlock(
    wEmoji, wName, lEmoji, lName,
    "Winnaar geeft 2 laagste aan verliezer",
    swapState.winnerGives
  ));

  swapPanel.appendChild(row);
}

// ── Modus-selectie ────────────────────────────────────────────────
function renderModeSelect(options){
  if(state.phase!=="modeSelect"){ modePanel.style.display="none"; return; }
  modePanel.style.display="block";
  const isLoser=state.result&&state.you&&state.you.id===state.result.loserId;
  const loser=state.players.find(p=>p.id===(state.result&&state.result.loserId));
  modeDesc.textContent=isLoser
    ?"Jij verliest — maar jij mag de volgende variant kiezen!"
    :"Wachten op "+(loser?loser.name:"de verliezer")+"...";
  modeBtns.innerHTML="";
  if(!isLoser||!options) return;
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
  const inGame=state.phase==="playing";
  const yourTurn=inGame&&state.you&&state.turnPlayerId===state.you.id;
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
  // Toon swap overlay als phase = swap
  if (swapOverlay){
    if(state.phase==="swap"){
      swapOverlay.className = "active";
      renderSwap(state.swapState);
    } else {
      swapOverlay.className = "";
    }
  } else {
    console.warn("[UI] swapOverlay ontbreekt in index.html");
  }
modePanel.style.display   = state.phase==="modeSelect" ? "block" : "none";
  endPanel.style.display    = "none";
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
    swapOverlay.className="";modePanel.style.display="none";endPanel.style.display="none";
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
