const path   = require("path");
const express= require("express");
const http   = require("http");
const {Server}=require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname,"public")));

const RANKS    =["4","5","6","7","8","9","10","J","Q","K","A","2","3"];
const RSORT    =Object.fromEntries(RANKS.map((r,i)=>[r,i]));
const SUITS    =["klaver","ruit","hart","schop"];
const SSYM     ={klaver:"♣",ruit:"♦",hart:"♥",schop:"♠"};
const GHOST_ID ="__ghost__";

function makeDeck(n){
  const d=[];
  for(let k=0;k<n;k++) for(const s of SUITS) for(const r of RANKS)
    d.push({id:k+"-"+r+"-"+s+"-"+Math.random().toString(16).slice(2,8),rank:r,suit:SSYM[s],sort:RSORT[r]});
  return d;
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function genCode(){
  const c="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join("");
}

const rooms=new Map();

function pub(p){
  return{id:p.id,name:p.name,emoji:p.emoji,color:p.color,cardCount:p.hand.length,isGhost:!!p.isGhost};
}
function snap(room,pid){
  const you=room.players.find(p=>p.id===pid);
  const turn=room.phase==="playing"?room.players[room.turnIndex]:null;
  return{
    roomCode:room.code,phase:room.phase,hostId:room.hostId,
    turnPlayerId:turn?turn.id:null,
    players:room.players.map(pub),
    hand:you?you.hand:[],
    pile:(room.round&&room.round.pile)||null,
    actLog:room.actLog||[],
    result:room.result||null,
  };
}
function bcast(room){
  for(const p of room.players){
    if(p.isGhost) continue;
    io.to(p.socketId).emit("roomUpdate",snap(room,p.id));
  }
}
function toast(room,text,kind){
  for(const p of room.players){
    if(p.isGhost) continue;
    io.to(p.socketId).emit("toast",{text,kind:kind||"info"});
  }
}
function cur(room){return room.players[room.turnIndex];}
function setTurn(room,pid){
  const i=room.players.findIndex(p=>p.id===pid);
  if(i>=0) room.turnIndex=i;
}

// ── Ghost (2-speler modus) ─────────────────────────────────────
function ghostPlayer(){
  return{id:GHOST_ID,socketId:null,name:"Computer",emoji:"🤖",color:"#556070",hand:[],isGhost:true};
}
function syncGhost(room){
  const real=room.players.filter(p=>!p.isGhost).length;
  const has =room.players.some(p=>p.isGhost);
  if(real===2 && !has) room.players.push(ghostPlayer());
  if(real!==2 &&  has) room.players=room.players.filter(p=>!p.isGhost);
}

// ── Activiteitenlog ────────────────────────────────────────────
function logAct(room,player,type,extra){
  if(!room.actLog) room.actLog=[];
  room.actLog.push({
    id:Date.now()+"-"+Math.random().toString(16).slice(2,7),
    playerName:player.name,
    emoji:player.emoji,
    color:player.color,
    type,...extra,
    ts:Date.now(),
  });
  if(room.actLog.length>20) room.actLog.shift();
}

// ── Kaarten delen ──────────────────────────────────────────────
function dealEqual(room){
  const rn=room.players.filter(p=>!p.isGhost).length;
  const nd=rn>=5?2:1;
  const deck=shuffle(makeDeck(nd));
  const n=room.players.length;
  const base=Math.floor(deck.length/n);
  for(const p of room.players) p.hand=[];
  for(let i=0;i<base;i++) for(const p of room.players) p.hand.push(deck.pop());
}
function cwOrder(room,startId){
  const n=room.players.length;
  const si=room.players.findIndex(p=>p.id===startId);
  const ord=[];
  for(let k=0;k<n;k++){
    const p=room.players[(si+k)%n];
    if(p.hand.length>0) ord.push(p.id);
  }
  return ord;
}
function startRound(room,startId){
  if(!room.players.find(p=>p.id===startId&&p.hand.length>0)){
    const si=room.players.findIndex(p=>p.id===startId);
    const n=room.players.length;
    for(let k=1;k<=n;k++){
      const p=room.players[(si+k)%n];
      if(p.hand.length>0){startId=p.id;break;}
    }
  }
  room.round={starterId:startId,order:cwOrder(room,startId),acted:[],pile:null};
  setTurn(room,startId);
  const starter=cur(room);
  toast(room,"Nieuwe ronde — "+(starter?starter.name:"?")+" opent.","info");
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
  const still=room.players.filter(p=>p.hand.length>0&&!p.isGhost);
  if(still.length>1) return false;
  room.phase="ended";
  const loser=still[0]||null;
  const ranking=room.finishOrder.filter(id=>id!==GHOST_ID).slice();
  if(loser&&ranking.indexOf(loser.id)===-1) ranking.push(loser.id);
  room.result={
    loserId:loser?loser.id:null,
    ranking:ranking.map(id=>{
      const pl=room.players.find(x=>x.id===id);
      return pl?pub(pl):{id,name:"?",emoji:"🎴",color:"#999",cardCount:0,isGhost:false};
    }),
  };
  toast(room,loser?"Spel klaar! Verliezer: "+loser.name:"Spel klaar!","warn");
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
    if(checkEnd(room)){bcast(room);return;}
    setTimeout(function(){startRound(room,winnerId);bcast(room);},200);
  },3000);
}
function validate(room,player,cardIds){
  if(!cardIds||!cardIds.length) return{ok:false,error:"Selecteer minstens 1 kaart."};
  const cards=cardIds.map(id=>player.hand.find(c=>c.id===id)).filter(Boolean);
  if(cards.length!==cardIds.length) return{ok:false,error:"Je hebt deze kaarten niet."};
  const rank=cards[0].rank;
  for(const c of cards) if(c.rank!==rank) return{ok:false,error:"Alle kaarten moeten dezelfde waarde hebben."};
  const count=cards.length;
  if(rank==="3") return{ok:true,play:{rank,count,isThree:true,cardsShown:cards.map(c=>({rank:c.rank,suit:c.suit}))}};
  const pile=room.round.pile;
  if(pile){
    if(count!==pile.count) return{ok:false,error:"Moet exact "+pile.count+" kaart(en) zijn."};
    if(RSORT[rank]<=RSORT[pile.rank]) return{ok:false,error:"Te laag — speel hoger of pas."};
  }
  return{ok:true,play:{rank,count,isThree:false,cardsShown:cards.map(c=>({rank:c.rank,suit:c.suit}))}};
}
function applyPlay(room,player,cardIds,play){
  player.hand=player.hand.filter(c=>!cardIds.includes(c.id));
  room.round.pile={rank:play.rank,count:play.count,cardsShown:play.cardsShown,lastPlayedBy:player.id};
}
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
    endRound(room,pile&&pile.lastPlayedBy?pile.lastPlayedBy:room.round.starterId);
  } else {
    ghostAutoAct(room);
    bcast(room);
  }
}
function resetToLobby(room){
  room.phase="lobby";room.round=null;room.finishOrder=[];room.result=null;room.actLog=[];
  for(const p of room.players) p.hand=[];
  room.players=room.players.filter(p=>!p.isGhost);
}

// ── Socket handlers ────────────────────────────────────────────
io.on("connection",function(socket){
  socket.data.roomCode=null;

  socket.on("createRoom",function(profile,cb){
    let code; do{code=genCode();}while(rooms.has(code));
    const you={id:socket.id,name:((profile&&profile.name)||"Speler").slice(0,18),emoji:(profile&&profile.emoji)||"🦊",color:(profile&&profile.color)||"#6ae4a6",socketId:socket.id,hand:[],isGhost:false};
    const room={code,hostId:you.id,phase:"lobby",players:[you],turnIndex:0,round:null,finishOrder:[],result:null,actLog:[]};
    rooms.set(code,room);
    socket.join(code);socket.data.roomCode=code;
    cb&&cb({ok:true,roomCode:code,you:pub(you)});
    bcast(room);
  });

  socket.on("joinRoom",function(data,cb){
    const code=((data&&data.roomCode)||"").toUpperCase().slice(0,6);
    const room=rooms.get(code);
    if(!room)              return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.phase!=="lobby") return cb&&cb({ok:false,error:"Spel is al gestart."});
    const you={id:socket.id,name:((data&&data.profile&&data.profile.name)||"Speler").slice(0,18),emoji:(data&&data.profile&&data.profile.emoji)||"🦊",color:(data&&data.profile&&data.profile.color)||"#6ae4a6",socketId:socket.id,hand:[],isGhost:false};
    room.players.push(you);
    socket.join(code);socket.data.roomCode=code;
    cb&&cb({ok:true,roomCode:code,you:pub(you)});
    toast(room,you.name+" joined.","ok");
    bcast(room);
  });

  socket.on("startGame",function(_,cb){
    const room=rooms.get(socket.data.roomCode);
    if(!room)                  return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.hostId!==socket.id)   return cb&&cb({ok:false,error:"Alleen host kan starten."});
    const real=room.players.filter(p=>!p.isGhost).length;
    if(real<2)                 return cb&&cb({ok:false,error:"Minstens 2 spelers nodig."});
    room.phase="playing";room.finishOrder=[];room.result=null;room.actLog=[];
    syncGhost(room);
    dealEqual(room);
    let sid=room.hostId;
    if(!room.players.find(p=>p.id===sid&&p.hand.length>0))
      sid=(room.players.find(p=>p.hand.length>0&&!p.isGhost)||room.players[0]).id;
    startRound(room,sid);
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
    logAct(room,p,"play",{cards:v.play.cardsShown,rank:v.play.rank,count:v.play.count});
    markDone(room,p.id);
    if(v.play.isThree){
      toast(room,"🟢 "+p.name+" speelde een 3 — ronde gewonnen!","ok");
      bcast(room);
      endRound(room,p.id);
      return cb&&cb({ok:true});
    }
    toast(room,p.name+" speelde "+v.play.count+"x "+v.play.rank+".","info");
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
    if(!room.round.pile&&room.round.starterId===p.id) return cb&&cb({ok:false,error:"Jij opent de ronde — je moet spelen."});
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

  socket.on("rematch",function(_,cb){
    const room=rooms.get(socket.data.roomCode);
    if(!room)                  return cb&&cb({ok:false,error:"Kamer niet gevonden."});
    if(room.hostId!==socket.id)   return cb&&cb({ok:false,error:"Alleen host kan opnieuw starten."});
    room.phase="playing";room.finishOrder=[];room.result=null;room.actLog=[];
    syncGhost(room);
    dealEqual(room);
    let sid=room.hostId;
    if(!room.players.find(p=>p.id===sid&&p.hand.length>0))
      sid=(room.players.find(p=>p.hand.length>0&&!p.isGhost)||room.players[0]).id;
    startRound(room,sid);
    bcast(room);
    cb&&cb({ok:true});
  });

  socket.on("leaveRoom",function(_,cb){
    const code=socket.data.roomCode;
    const room=rooms.get(code);
    if(!room) return cb&&cb({ok:true});
    room.players=room.players.filter(p=>p.id!==socket.id);
    socket.leave(code);socket.data.roomCode=null;
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
