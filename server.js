const path    = require("path");
const express = require("express");
const http    = require("http");
const {Server}= require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname,"public")));

const RANKS    = ["4","5","6","7","8","9","10","J","Q","K","A","2","3"];
const RSORT    = Object.fromEntries(RANKS.map((r,i)=>[r,i]));
const SUITS    = ["klaver","ruit","hart","schop"];
const SSYM     = {klaver:"♣", ruit:"♦", hart:"♥", schop:"♠"};
const RED_SUITS= new Set(["♥","♦"]);
const GHOST_ID = "__ghost__";

const MODES = {
  traditioneel: { label:"Traditioneel",  icon:"🃏" },
  aanleggen:    { label:"Aanleggen",      icon:"📥" },
  kleurbekennen:{ label:"Kleur bekennen", icon:"🎨" },
};

// ── Kaarten ─────────────────────────────────────────────────────
function makeDeck(n){
  const d=[];
  for(let k=0;k<n;k++) for(const s of SUITS) for(const r of RANKS)
    d.push({id:k+"-"+r+"-"+s+"-"+Math.random().toString(16).slice(2,8),
            rank:r, suit:SSYM[s], sort:RSORT[r]});
  return d;
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function cardColor(suit){ return RED_SUITS.has(suit)?"red":"black"; }

// ── Ruimte ──────────────────────────────────────────────────────
function genCode(){
  const c="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join("");
}
const rooms = new Map();

// ── Publieke weergave ────────────────────────────────────────────
function pub(p){
  return{id:p.id,name:p.name,emoji:p.emoji,color:p.color,
         cardCount:p.hand.length,isGhost:!!p.isGhost};
}
function snap(room, pid){
  const you  = room.players.find(p=>p.id===pid);
  const turn = room.phase==="playing" ? room.players[room.turnIndex] : null;
  return {
    roomCode:      room.code,
    phase:         room.phase,       // lobby | playing | swap | modeSelect | ended
    hostId:        room.hostId,
    gameMode:      room.gameMode,
    turnPlayerId:  turn ? turn.id : null,
    players:       room.players.map(pub),
    hand:          you ? you.hand : [],
    pile:          (room.round && room.round.pile) || null,
    actLog:        room.actLog || [],
    result:        room.result || null,
    // swap-fase
    swapState:     room.swapState || null,
    // modeSelect-fase
    modeOptions:   room.phase==="modeSelect" ? Object.entries(MODES).map(([k,v])=>({key:k,...v})) : null,
  };
}
function bcast(room){
  for(const p of room.players){
    if(p.isGhost) continue;
    io.to(p.socketId).emit("roomUpdate", snap(room,p.id));
  }
}
function toast(room,text,kind){
  for(const p of room.players){
    if(p.isGhost) continue;
    io.to(p.socketId).emit("toast",{text,kind:kind||"info"});
  }
}

// ── Hulpfuncties ────────────────────────────────────────────────
function cur(room){ return room.players[room.turnIndex]; }
function setTurn(room,pid){
  const i=room.players.findIndex(p=>p.id===pid);
  if(i>=0) room.turnIndex=i;
}
function ghostPlayer(){
  return{id:GHOST_ID,socketId:null,name:"Computer",emoji:"🤖",
         color:"#556070",hand:[],isGhost:true};
}
function syncGhost(room){
  const real=room.players.filter(p=>!p.isGhost).length;
  const has =room.players.some(p=>p.isGhost);
  if(real===2 && !has) room.players.push(ghostPlayer());
  if(real!==2 &&  has) room.players=room.players.filter(p=>!p.isGhost);
}

// ── Activiteitenlog ─────────────────────────────────────────────
function logAct(room,player,type,extra){
  if(!room.actLog) room.actLog=[];
  room.actLog.push({
    id:Date.now()+"-"+Math.random().toString(16).slice(2,7),
    playerName:player.name, emoji:player.emoji, color:player.color,
    type, ...extra, ts:Date.now(),
  });
  if(room.actLog.length>20) room.actLog.shift();
}

// ── Kaarten delen ────────────────────────────────────────────────
function dealEqual(room){
  const rn  = room.players.filter(p=>!p.isGhost).length;
  const nd  = rn>=5 ? 2 : 1;
  const deck= shuffle(makeDeck(nd));
  const n   = room.players.length;
  const base= Math.floor(deck.length/n);
  for(const p of room.players) p.hand=[];
  for(let i=0;i<base;i++) for(const p of room.players) p.hand.push(deck.pop());
}

// ── Rondelogica ──────────────────────────────────────────────────
function cwOrder(room,startId){
  const n =room.players.length;
  const si=room.players.findIndex(p=>p.id===startId);
  const ord=[];
  for(let k=0;k<n;k++){
    const p=room.players[(si+k)%n];
    if(p.hand.length>0) ord.push(p.id);
  }
  return ord;
}
function startRound(room,startId){
  // zorg voor geldige starter
  if(!room.players.find(p=>p.id===startId&&p.hand.length>0)){
    const si=room.players.findIndex(p=>p.id===startId);
    for(let k=1;k<=room.players.length;k++){
      const p=room.players[(si+k)%room.players.length];
      if(p.hand.length>0){startId=p.id;break;}
    }
  }
  room.round={starterId:startId, order:cwOrder(room,startId), acted:[], pile:null};
  setTurn(room,startId);
  toast(room,"Nieuwe ronde — "+(cur(room)?cur(room).name:"?")+" opent.","info");
  ghostAutoAct(room);
}
function markDone(room,pid){
  const p=room.players.find(x=>x.id===pid);
  if(!p||p.hand.length!==0||p.isGhost) return;
  if(room.finishOrder.indexOf(p.id)===-1){
    room.finishOrder.push(p.id);
    toast(room,p.name+" is klaar!","ok");
  }
}
function checkEnd(room){
  const realPlayers = room.players.filter(p=>!p.isGhost);
  const stillHaveCards = realPlayers.filter(p=>p.hand.length>0);
  // Spel eindigt als max 1 echte speler nog kaarten heeft
  if(stillHaveCards.length > 1) return false;

  const loser = stillHaveCards[0] || null; // degene die nog kaarten heeft = verliezer
  // Bouw ranking: finishOrder (wie als eerst klaar was) + loser achteraan
  const ranking = room.finishOrder.filter(id=>id!==GHOST_ID).slice();
  if(loser && !ranking.includes(loser.id)) ranking.push(loser.id);
  // Voeg eventuele ontbrekende echte spelers toe
  for(const p of realPlayers){
    if(!ranking.includes(p.id)) ranking.push(p.id);
  }
  room.result = {
    loserId:  loser ? loser.id : null,
    winnerId: ranking[0] || null,
    ranking:  ranking.map(id=>{
      const pl = room.players.find(x=>x.id===id);
      return pl ? pub(pl) : {id,name:"?",emoji:"🎴",color:"#999",cardCount:0,isGhost:false};
    }),
  };
  room.phase = "ended";
  toast(room, loser ? "Spel klaar! Verliezer: "+loser.name : "Spel klaar!", "warn");
  return true;
}
function endRound(room,winnerId){
  const w=room.players.find(p=>p.id===winnerId);
  logAct(room,w||{name:"?",emoji:"🏆",color:"#6ae4a6"},"win",{});
  toast(room,(w?w.name:"?")+" wint de ronde!","ok");
  bcast(room);
  setTimeout(function(){
    if(!rooms.has(room.code)) return;
    room.round.pile=null;
    bcast(room);
    if(checkEnd(room)){
      // Spel klaar: verliezer kiest eerst de variant
      setTimeout(function(){ startModeSelect(room); bcast(room); },500);
      return;
    }
    setTimeout(function(){ startRound(room,winnerId); bcast(room); },200);
  },3000);
}

// ════════════════════════════════════════════════════════════════
// VALIDATIE — per spelvariant
// ════════════════════════════════════════════════════════════════

// Gedeeld: bouw play-object
function buildPlay(cards){
  const rank=cards[0].rank;
  const isThree=rank==="3";
  return{
    rank, count:cards.length, isThree,
    cardsShown: cards.map(c=>({rank:c.rank,suit:c.suit,color:cardColor(c.suit)})),
  };
}

// ── Traditioneel ─────────────────────────────────────────────────
function validateTraditioneel(room,player,cardIds){
  if(!cardIds||!cardIds.length) return{ok:false,error:"Selecteer minstens 1 kaart."};
  const cards=cardIds.map(id=>player.hand.find(c=>c.id===id)).filter(Boolean);
  if(cards.length!==cardIds.length) return{ok:false,error:"Je hebt deze kaarten niet."};
  const rank=cards[0].rank;
  for(const c of cards) if(c.rank!==rank) return{ok:false,error:"Alle kaarten moeten dezelfde waarde hebben."};
  const play=buildPlay(cards);
  if(play.isThree) return{ok:true,play};
  const pile=room.round.pile;
  if(pile){
    if(play.count!==pile.count) return{ok:false,error:"Moet exact "+pile.count+" kaart(en) zijn."};
    if(RSORT[rank]<=RSORT[pile.rank]) return{ok:false,error:"Te laag — speel hoger of pas."};
  }
  return{ok:true,play};
}

// ── Aanleggen ────────────────────────────────────────────────────
function validateAanleggen(room,player,cardIds){
  if(!cardIds||!cardIds.length) return{ok:false,error:"Selecteer minstens 1 kaart."};
  const cards=cardIds.map(id=>player.hand.find(c=>c.id===id)).filter(Boolean);
  if(cards.length!==cardIds.length) return{ok:false,error:"Je hebt deze kaarten niet."};
  const rank=cards[0].rank;
  for(const c of cards) if(c.rank!==rank) return{ok:false,error:"Alle kaarten moeten dezelfde waarde hebben."};
  const play=buildPlay(cards);
  if(play.isThree) return{ok:true,play};
  const pile=room.round.pile;
  if(!pile) return{ok:true,play}; // opener: vrij
  
  // Optie 1: hoger spelen (zelfde aantal)
  if(play.count===pile.count && RSORT[rank]>RSORT[pile.rank]){
    // Markeer dat er verhoogd is (aanleggen niet meer toegestaan)
    return{ok:true,play:{...play,wasRaised:true}};
  }
  
  // Optie 2: aanleggen (zelfde rank als pile, 1 of meer)
  // MAAR: als laatste actie verhogen was, mag je niet meer aanleggen
  if(rank===pile.rank){
    if(pile.wasRaised){
      return{ok:false,error:"Na verhogen mag je niet meer aanleggen. Speel hoger."};
    }
    const combined={
      rank: pile.rank,
      count: pile.count+play.count,
      cardsShown: [...pile.cardsShown,...play.cardsShown],
      lastPlayedBy: player.id,
      wasRaised: false, // aanleggen reset de vlag niet
    };
    return{ok:true,play:{...play,isAppend:true,combinedPile:combined}};
  }
  return{ok:false,error:"Speel hoger ("+pile.count+"×) of leg aan ("+pile.rank+")."};
}

// ── Kleur bekennen ───────────────────────────────────────────────
function validateKleurbekennen(room,player,cardIds){
  if(!cardIds||!cardIds.length) return{ok:false,error:"Selecteer minstens 1 kaart."};
  const cards=cardIds.map(id=>player.hand.find(c=>c.id===id)).filter(Boolean);
  if(cards.length!==cardIds.length) return{ok:false,error:"Je hebt deze kaarten niet."};
  const rank=cards[0].rank;
  for(const c of cards) if(c.rank!==rank) return{ok:false,error:"Alle kaarten moeten dezelfde waarde hebben."};
  const play=buildPlay(cards);
  if(play.isThree) return{ok:true,play};
  const pile=room.round.pile;
  if(!pile) return{ok:true,play}; // opener: vrij
  
  const pileColors=pile.cardsShown.map(c=>c.color);
  
  // Optie 1: hoger spelen — moet zelfde kleurpatroon hebben
  if(play.count===pile.count && RSORT[rank]>RSORT[pile.rank]){
    const playColors=play.cardsShown.map(c=>c.color);
    const pRed=pileColors.filter(c=>c==="red").length;
    const plRed=playColors.filter(c=>c==="red").length;
    if(pRed!==plRed) return{ok:false,error:"Verkeerde kleurverdeling. Nodig: "+pRed+" rood, "+(pile.count-pRed)+" zwart."};
    return{ok:true,play:{...play,wasRaised:true}};
  }
  
  // Optie 2: aanleggen — zelfde rank
  // MAAR: als laatste actie verhogen was, mag je niet meer aanleggen
  if(rank===pile.rank){
    if(pile.wasRaised){
      return{ok:false,error:"Na verhogen mag je niet meer aanleggen. Speel hoger met juiste kleur."};
    }
    const combined={
      rank:pile.rank, count:pile.count+play.count,
      cardsShown:[...pile.cardsShown,...play.cardsShown],
      lastPlayedBy:player.id,
      wasRaised:false,
    };
    return{ok:true,play:{...play,isAppend:true,combinedPile:combined}};
  }
  return{ok:false,error:"Verkeerde kleur of te laag. Speel hoger met juiste kleur of leg aan."};
}

function validate(room,player,cardIds){
  if(room.gameMode==="aanleggen")     return validateAanleggen(room,player,cardIds);
  if(room.gameMode==="kleurbekennen") return validateKleurbekennen(room,player,cardIds);
  return validateTraditioneel(room,player,cardIds);
}

function applyPlay(room,player,cardIds,play){
  player.hand=player.hand.filter(c=>!cardIds.includes(c.id));
  if(play.isAppend && play.combinedPile){
    room.round.pile=play.combinedPile;
  } else {
    room.round.pile={
      rank:play.rank,
      count:play.count,
      cardsShown:play.cardsShown,
      lastPlayedBy:player.id,
      wasRaised: play.wasRaised || false, // verhogen = true, anders false
    };
  }
}

// ── Beurt doorschuiven ───────────────────────────────────────────
function advanceLap(room){
  for(const pid of room.round.order){
    if(room.round.acted.includes(pid)) continue;
    const p=room.players.find(x=>x.id===pid);
    if(!p||p.hand.length===0){room.round.acted.push(pid);continue;}
    setTurn(room,pid);
    return true;
  }
  return false;
}
function ghostAutoAct(room){
  const p=cur(room);
  if(!p||!p.isGhost||room.round.acted.includes(GHOST_ID)) return;
  room.round.acted.push(GHOST_ID);
  afterAction(room);
}
function afterAction(room){
  const moved=advanceLap(room);
  if(!moved){
    const pile=room.round.pile;
    endRound(room, pile&&pile.lastPlayedBy ? pile.lastPlayedBy : room.round.starterId);
  } else {
    ghostAutoAct(room);
    bcast(room);
  }
}


// ════════════════════════════════════════════════════════════════
// MODUS SELECTIE (winnaar kiest volgende spelvariant)
// ════════════════════════════════════════════════════════════════
function startModeSelect(room){
  room.phase="modeSelect";
  room.swapState=null;
  room.round=null;          // leeg de ronde zodat turnPlayerId null wordt
  room.turnIndex=0;
  const loser=room.players.find(p=>p.id===(room.result&&room.result.loserId));
  toast(room,(loser?loser.name:"Verliezer")+" kiest de volgende spelvariant.","info");
  bcast(room);
}

// ════════════════════════════════════════════════════════════════
// NIEUW POTJE STARTEN
// ════════════════════════════════════════════════════════════════
function startNewGame(room,mode){
  // Bewaar winnaar/verliezer info VOOR we result clearen
  const prevWinnerId = room.result && room.result.winnerId;
  const prevLoserId  = room.result && room.result.loserId;

  console.log("[GAME] startNewGame aangeroepen. Mode:", mode, "prevWinnerId:", prevWinnerId, "prevLoserId:", prevLoserId);

  room.gameMode   = mode||"traditioneel";
  room.finishOrder= [];
  room.actLog     = [];
  syncGhost(room);
  dealEqual(room);  // Deel NIEUWE kaarten

  // Bepaal starter: winnaar van vorig potje
  let sid = prevWinnerId || room.hostId;
  if(!room.players.find(p=>p.id===sid&&p.hand.length>0))
    sid=(room.players.find(p=>p.hand.length>0&&!p.isGhost)||room.players[0]).id;

  console.log("[GAME] Kaarten gedeeld. Nu swap starten...");

  // Start swap-fase (10 sec popup) VOOR het spelen begint
  startSwapPhase(room, prevWinnerId, prevLoserId, sid);
}

function startSwapPhase(room, prevWinnerId, prevLoserId, starterId){
  const winner = room.players.find(p=>p.id===prevWinnerId);
  const loser  = room.players.find(p=>p.id===prevLoserId);

  console.log("[SWAP] startSwapPhase aangeroepen. winner:", winner?winner.name:"null", "loser:", loser?loser.name:"null");

  // Geen swap mogelijk (eerste potje, ghost, of geen winnaar/verliezer)
  if(!winner||!loser||winner.isGhost||loser.isGhost||!prevWinnerId||!prevLoserId){
    console.log("[SWAP] Geen swap mogelijk. Start direct het spel.");
    room.phase      = "playing";
    room.result     = null;
    room.swapState  = null;
    startRound(room, starterId);
    bcast(room);
    return;
  }

  // Verliezer geeft 2 HOOGSTE aan winnaar
  // Winnaar geeft 2 LAAGSTE aan verliezer
  const lHand = [...loser.hand].sort((a,b)=>b.sort-a.sort);  // hoog→laag
  const wHand = [...winner.hand].sort((a,b)=>a.sort-b.sort); // laag→hoog

  const loserGives  = lHand.slice(0, Math.min(2, lHand.length));  // verliezer's 2 hoogste
  const winnerGives = wHand.slice(0, Math.min(2, wHand.length)); // winnaar's 2 laagste

  console.log("[SWAP] loserGives:", loserGives.map(c=>c.rank), "winnerGives:", winnerGives.map(c=>c.rank));

  // Als er niets te ruilen valt
  if(loserGives.length===0 && winnerGives.length===0){
    console.log("[SWAP] Geen kaarten om te ruilen. Start direct het spel.");
    room.phase      = "playing";
    room.result     = null;
    room.swapState  = null;
    startRound(room, starterId);
    bcast(room);
    return;
  }

  // Bouw swapState VOOR de ruil (zodat we originele kaarten kunnen tonen)
  room.swapState = {
    winnerId:    winner.id,
    winnerName:  winner.name,
    winnerEmoji: winner.emoji,
    loserId:     loser.id,
    loserName:   loser.name,
    loserEmoji:  loser.emoji,
    loserGives:  loserGives.map(c=>({rank:c.rank, suit:c.suit, id:c.id})),
    winnerGives: winnerGives.map(c=>({rank:c.rank, suit:c.suit, id:c.id})),
    secondsLeft: 10,
  };

  // Voer de ruil UIT
  for(const c of loserGives){
    loser.hand  = loser.hand.filter(x=>x.id!==c.id);
    winner.hand.push(c);
  }
  for(const c of winnerGives){
    winner.hand = winner.hand.filter(x=>x.id!==c.id);
    loser.hand.push(c);
  }

  console.log("[SWAP] Ruil uitgevoerd. Setting phase=swap en broadcasting...");

  // Zet phase op SWAP (clients tonen popup)
  room.phase  = "swap";
  room.result = null; // Clear result zodat mode-select verdwijnt
  bcast(room);

  toast(room,
    loser.name+" geeft "+loserGives.length+"× hoogste aan "+winner.name+
    " · "+winner.name+" geeft "+winnerGives.length+"× laagste aan "+loser.name,
    "info");

  // Countdown 10 seconden
  let countdown = 10;
  const timer = setInterval(function(){
    if(!rooms.has(room.code)){
      clearInterval(timer);
      return;
    }
    countdown--;
    room.swapState.secondsLeft = countdown;
    bcast(room);
    
    if(countdown<=0){
      clearInterval(timer);
      console.log("[SWAP] Countdown klaar. Start nu het spel.");
      room.phase     = "playing";
      room.swapState = null;
      startRound(room, starterId);
      bcast(room);
    }
  }, 1000);
}

function resetToLobby(room){
  room.phase="lobby";room.round=null;room.finishOrder=[];
  room.result=null;room.actLog=[];room.swapState=null;
  room.gameMode="traditioneel";
  for(const p of room.players) p.hand=[];
  room.players=room.players.filter(p=>!p.isGhost);
}

// ════════════════════════════════════════════════════════════════
// SOCKET HANDLERS
// ════════════════════════════════════════════════════════════════
io.on("connection",function(socket){
  socket.data.roomCode=null;

  socket.on("createRoom",function(profile,cb){
    let code; do{code=genCode();}while(rooms.has(code));
    const you={id:socket.id,
               name:((profile&&profile.name)||"Speler").slice(0,18),
               emoji:(profile&&profile.emoji)||"🦊",
               color:(profile&&profile.color)||"#6ae4a6",
               socketId:socket.id,hand:[],isGhost:false};
    const room={code,hostId:you.id,phase:"lobby",players:[you],
                turnIndex:0,round:null,finishOrder:[],result:null,
                actLog:[],swapState:null,gameMode:"traditioneel"};
    rooms.set(code,room);
    socket.join(code); socket.data.roomCode=code;
    cb&&cb({ok:true,roomCode:code,you:pub(you)});
    bcast(room);
  });

  socket.on("joinRoom",function(data,cb){
    const code=((data&&data.roomCode)||"").toUpperCase().slice(0,6);
    const room=rooms.get(code);
    if(!room)              return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.phase!=="lobby") return cb&&cb({ok:false,error:"Spel is al gestart."});
    const you={id:socket.id,
               name:((data&&data.profile&&data.profile.name)||"Speler").slice(0,18),
               emoji:(data&&data.profile&&data.profile.emoji)||"🦊",
               color:(data&&data.profile&&data.profile.color)||"#6ae4a6",
               socketId:socket.id,hand:[],isGhost:false};
    room.players.push(you);
    socket.join(code); socket.data.roomCode=code;
    cb&&cb({ok:true,roomCode:code,you:pub(you)});
    toast(room,you.name+" joined.","ok");
    bcast(room);
  });

  socket.on("startGame",function(_,cb){
    const room=rooms.get(socket.data.roomCode);
    if(!room)                   return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.hostId!==socket.id)    return cb&&cb({ok:false,error:"Alleen host kan starten."});
    const real=room.players.filter(p=>!p.isGhost).length;
    if(real<2)                  return cb&&cb({ok:false,error:"Minstens 2 spelers nodig."});
    startNewGame(room,"traditioneel");
    bcast(room);
    cb&&cb({ok:true});
  });

  // Verliezer kiest volgende modus
  socket.on("selectMode",function(data,cb){
    const room=rooms.get(socket.data.roomCode);
    if(!room)                         return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.phase!=="modeSelect")        return cb&&cb({ok:false,error:"Niet in modusbepaling."});
    if(socket.id!==(room.result&&room.result.loserId))
                                      return cb&&cb({ok:false,error:"Alleen de verliezer kiest."});
    const mode=data&&data.mode;
    if(!MODES[mode])                  return cb&&cb({ok:false,error:"Onbekende modus."});
    toast(room,MODES[mode].icon+" "+MODES[mode].label+" gekozen!","ok");
    startNewGame(room,mode);
    bcast(room);
    cb&&cb({ok:true});
  });

  socket.on("playCards",function(data,cb){
    const room=rooms.get(socket.data.roomCode);
    if(!room)                  return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.phase!=="playing")   return cb&&cb({ok:false,error:"Spel is niet bezig."});
    const p=cur(room);
    if(!p||p.id!==socket.id)   return cb&&cb({ok:false,error:"Jij bent niet aan de beurt."});
    if(room.round.acted.includes(p.id)) return cb&&cb({ok:false,error:"Je hebt al gespeeld."});
    const v=validate(room,p,data&&data.cardIds);
    if(!v.ok) return cb&&cb(v);
    room.round.acted.push(p.id);
    applyPlay(room,p,data.cardIds,v.play);
    const desc=v.play.isAppend
      ? "legde aan: "+v.play.count+"× "+v.play.rank
      : "speelde "+v.play.count+"× "+v.play.rank;
    logAct(room,p,"play",{cards:v.play.cardsShown,rank:v.play.rank,count:v.play.count,isAppend:!!v.play.isAppend});
    markDone(room,p.id);
    if(v.play.isThree){
      toast(room,"🟢 "+p.name+" speelde een 3 — ronde gewonnen!","ok");
      bcast(room);
      endRound(room,p.id);
      return cb&&cb({ok:true});
    }
    toast(room,p.name+" "+desc+".","info");
    afterAction(room);
    cb&&cb({ok:true});
  });

  socket.on("pass",function(_,cb){
    const room=rooms.get(socket.data.roomCode);
    if(!room)                  return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.phase!=="playing")   return cb&&cb({ok:false,error:"Spel is niet bezig."});
    const p=cur(room);
    if(!p||p.id!==socket.id)   return cb&&cb({ok:false,error:"Jij bent niet aan de beurt."});
    if(room.round.acted.includes(p.id)) return cb&&cb({ok:false,error:"Je hebt al geacteerd."});
    if(!room.round.pile&&room.round.starterId===p.id)
      return cb&&cb({ok:false,error:"Jij opent de ronde — je moet spelen."});
    room.round.acted.push(p.id);
    logAct(room,p,"pass",{});
    toast(room,p.name+" past.","info");
    afterAction(room);
    cb&&cb({ok:true});
  });

  socket.on("backToLobby",function(_,cb){
    const room=rooms.get(socket.data.roomCode);
    if(!room) return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    resetToLobby(room);
    toast(room,"Terug naar lobby.","info");
    bcast(room);
    cb&&cb({ok:true});
  });

  socket.on("leaveRoom",function(_,cb){
    const code=socket.data.roomCode;
    const room=rooms.get(code);
    if(!room) return cb&&cb({ok:true});
    room.players=room.players.filter(p=>p.id!==socket.id);
    socket.leave(code); socket.data.roomCode=null;
    const real=room.players.filter(p=>!p.isGhost);
    if(real.length===0){rooms.delete(code);return cb&&cb({ok:true});}
    if(room.hostId===socket.id) room.hostId=real[0].id;
    resetToLobby(room);
    toast(room,"Iemand verliet de kamer.","warn");
    bcast(room);
    cb&&cb({ok:true});
  });

  socket.on("disconnect",function(){
    const code=socket.data.roomCode;
    const room=rooms.get(code);
    if(!room) return;
    room.players=room.players.filter(p=>p.id!==socket.id);
    const real=room.players.filter(p=>!p.isGhost);
    if(real.length===0){rooms.delete(code);return;}
    if(room.hostId===socket.id) room.hostId=real[0].id;
    resetToLobby(room);
    toast(room,"Iemand disconnectte. Terug naar lobby.","warn");
    bcast(room);
  });
});

server.listen(PORT,function(){console.log("Server running on http://localhost:"+PORT);});
