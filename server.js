import express from 'express';
import {CHARACTERS} from './characters.js';
import {gemini,info} from './gemini.js';
const app=express();app.use(express.json());app.use(express.static('public'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MEM=+process.env.MEMORY_LINES||40,ROUNDS=+process.env.DAY_ROUNDS||2,DELAY=+process.env.MSG_DELAY_MS||1500;
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const MAFIA=['killer','silencer'];const isMafia=p=>MAFIA.includes(p.role);
let G=null;const clients=new Set();
const emit=m=>{G.log.push(m);for(const c of clients)c.write(`data: ${JSON.stringify(m)}\n\n`);};
const alive=()=>G.players.filter(p=>p.alive);
// الذاكرة: كل لاعب يرى فقط ما يخصه
const tell=(ps,line)=>ps.forEach(p=>p.mem.push(line));
const pub=(who,text,kind='chat')=>{emit({kind,who,text,day:G.day});tell(alive(),who?`${who}: ${text}`:`[حدث] ${text}`);};
const sys=(text)=>pub(null,text,'event');
const err=(who,e)=>emit({kind:'error',who,text:`فشل Gemini: ${e.message}`});
function knows(p){
 const m=G.players.filter(x=>isMafia(x)&&x!==p).map(x=>x.name).join('، ');
 return `دورك السري: ${p.role}. `+(isMafia(p)?`فريق المافيا، زملاؤك: ${m}. `:'فريق القرية. ')+(p.notes.length?`معلوماتك: ${p.notes.join('؛ ')}. `:'');
}
async function ask(p,task,schema){
 const system=`أنت ${p.name} في لعبة مافيا. شخصيتك: ${p.persona}. تحدث بالعربية بأسلوب شخصيتك وقصّر كلامك (جملتان كحد أقصى). لا تكشف دورك إلا إن كان ذلك في مصلحتك. اللاعبون الأحياء: ${alive().map(x=>x.name).join('، ')}. ${knows(p)}`;
 return gemini(system,`ذاكرتك:\n${p.mem.slice(-MEM).join('\n')}\n\nالمطلوب: ${task}\nأجب JSON فقط بالشكل: ${schema}`);
}
const pick=(name,pool)=>pool.find(x=>x.name===name)||null;
async function target(p,task,pool){
 try{const r=await ask(p,task,'{"target":"الاسم"}');const t=pick(r.target,pool);if(t)return t;emit({kind:'error',who:p.name,text:'اختيار غير صالح، تم اختيار عشوائي'});}
 catch(e){err(p.name,e);}
 return shuffle(pool)[0];
}
function winner(){const m=alive().filter(isMafia).length,v=alive().length-m;return m===0?'village':m>=v?'mafia':null;}
function kill(p){p.alive=false;emit({kind:'reveal',who:p.name,text:`${p.name} خرج وكان دوره: ${p.role}`});tell(alive(),`[حدث] ${p.name} خرج وكان ${p.role}`);}
async function night(){
 G.phase='night';sys(`🌙 الليلة ${G.day}`);
 const killers=alive().filter(p=>p.role==='killer'),doc=alive().find(p=>p.role==='doctor'),det=alive().find(p=>p.role==='detective'),sil=alive().find(p=>p.role==='silencer');
 const villagers=alive().filter(p=>!isMafia(p));let victim=null,saved=null;G.silenced=new Set();
 if(killers.length){ // نقاش سري ثم اختيار
  const secret=(who,text)=>{emit({kind:'secret',who,text,to:'mafia'});tell(G.players.filter(x=>x.alive&&isMafia(x)),`[سري] ${who}: ${text}`);};
  try{const r=await ask(killers[0],'اقترح ضحية لزميلك سراً مع السبب','{"say":"...","target":"الاسم"}');secret(killers[0].name,r.say);}catch(e){err(killers[0].name,e);}
  if(killers[1]){victim=await target(killers[1],'قرر الضحية النهائية بعد نقاش زميلك (لا تختر أحداً من المافيا)',villagers);}
  else victim=await target(killers[0],'اختر الضحية (لا تختر أحداً من المافيا)',villagers);
 }
 if(doc)saved=await target(doc,'اختر لاعباً لحمايته الليلة',alive());
 if(det){const t=await target(det,'اختر لاعباً للتحقيق',alive().filter(x=>x!==det));
  det.notes.push(`${t.name} من ${isMafia(t)?'المافيا':'القرية'} (ليلة ${G.day})`);emit({kind:'secret',who:'نتيجة التحقيق',text:`${t.name}: ${isMafia(t)?'مافيا':'قرية'}`,to:'detective'});}
 if(sil){if(G.silCool>0){G.silCool--;}else{const t=await target(sil,'اختر لاعباً من القرية لإسكاته غداً',villagers.filter(x=>x!==sil));G.silenced.add(t.name);G.silCool=1;}}
 // حسم النتائج في المحرك
 G.day++;G.phase='day';
 if(victim&&victim!==saved){kill(victim);sys(`☀️ قُتل ${victim.name} هذه الليلة.`);}else sys('☀️ لم يُقتل أحد هذه الليلة.');
 if(G.silenced.size)sys(`🤐 تم إسكات: ${[...G.silenced].join('، ')}`);
}
async function day(){
 for(let r=0;r<ROUNDS&&!G.stop;r++)for(const p of shuffle(alive())){
  if(G.silenced.has(p.name))continue;
  try{const x=await ask(p,'تحدث في النقاش: اتهم أو دافع أو رد على غيرك. إن لم يكن لديك ما تقوله اجعل say فارغاً','{"say":"..."}');if(x.say)pub(p.name,x.say);}catch(e){err(p.name,e);}
  await sleep(DELAY);
 }
 G.phase='vote';sys('🗳️ بدأ التصويت');const tally={};
 for(const p of alive()){if(G.silenced.has(p.name))continue;
  const t=await target(p,'صوّت لإخراج لاعب',alive().filter(x=>x!==p));tally[t.name]=(tally[t.name]||0)+1;pub(p.name,`صوّت ضد ${t.name}`,'vote');}
 const max=Math.max(0,...Object.values(tally)),top=Object.keys(tally).filter(k=>tally[k]===max);
 if(top.length===1)kill(pick(top[0],G.players));else sys('تعادل الأصوات — لا يخرج أحد.'); // قاعدة التعادل
}
async function run(){
 while(!winner()&&!G.stop&&G.day<30){await night();if(winner())break;await day();}
 G.phase='over';const w=winner();emit({kind:'end',text:w==='mafia'?'فازت المافيا':w==='village'?'فازت القرية':'توقفت المباراة',roles:G.players.map(p=>`${p.name}: ${p.role}`)});
}
function assign(mode,manual){
 const base=[...Array(2).fill('killer'),'doctor','detective','silencer',...Array(10).fill('citizen')];
 if(mode==='manual'){const c={};Object.values(manual||{}).forEach(r=>c[r]=(c[r]||0)+1);
  const ok=Object.keys(manual||{}).length===15&&c.killer===2&&c.doctor===1&&c.detective===1&&c.silencer===1&&c.citizen===10;
  if(!ok)throw new Error('توزيع الأدوار غير صحيح: مطلوب 2 killer و1 doctor و1 detective و1 silencer و10 citizen');
  return CHARACTERS.map(c=>manual[c.name]);}
 return shuffle(base);
}
app.post('/api/start',(req,res)=>{
 try{if(G&&G.phase!=='over')throw new Error('مباراة جارية');
  const roles=assign(req.body.mode,req.body.roles);
  G={mode:req.body.mode,day:1,phase:'night',log:[],silenced:new Set(),silCool:0,stop:false,
   players:CHARACTERS.map((c,i)=>({...c,role:roles[i],alive:true,mem:[],notes:[]}))};
  res.json({ok:true});run().catch(e=>emit({kind:'error',text:e.message}));
 }catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/stop',(_,res)=>{if(G)G.stop=true;res.json({ok:true});});
app.get('/api/state',(_,res)=>res.json({gemini:info(),game:G&&{phase:G.phase,day:G.day,players:G.players.map(p=>({name:p.name,alive:p.alive,role:p.alive?undefined:p.role}))}}));
// المشاهد في وضع التحدي لا يرى الرسائل السرية؛ وفي اليدوي يراها
app.get('/api/events',(req,res)=>{res.set({'content-type':'text/event-stream','cache-control':'no-cache'});res.flushHeaders();
 const spec=G?.mode==='manual';const w={write:s=>{const m=JSON.parse(s.slice(6));if(m.kind==='secret'&&!spec)return;res.write(s);}};
 (G?.log||[]).forEach(m=>w.write(`data: ${JSON.stringify(m)}\n\n`));clients.add(w);req.on('close',()=>clients.delete(w));});
app.listen(process.env.PORT||3000,()=>console.log('Anime Mafia on',process.env.PORT||3000));
