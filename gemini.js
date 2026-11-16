const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const stats={requests:0,replies:0,errors:0,lastError:'',queued:0};
const CONC=+process.env.CONCURRENCY||3;let active=0;const q=[];
const pump=()=>{while(active<CONC&&q.length){const j=q.shift();stats.queued=q.length;active++;j.fn().then(j.res,j.rej).finally(()=>{active--;pump();});}};
const enqueue=fn=>new Promise((res,rej)=>{q.push({fn,res,rej});stats.queued=q.length;pump();});
export const info=()=>({model:process.env.GEMINI_MODEL||null,keySet:!!process.env.GEMINI_API_KEY,...stats});
export function gemini(system,user,tries=4){
 return enqueue(async()=>{
  const {GEMINI_API_KEY:key,GEMINI_MODEL:model}=process.env;
  if(!key||!model)throw new Error('GEMINI_API_KEY/GEMINI_MODEL غير مضبوطين');
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  for(let i=0;i<tries;i++){
   try{
    stats.requests++;
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
     body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{responseMimeType:'application/json',temperature:1}})});
    if(r.status===429||r.status>=500){await sleep(2000*2**i);continue;}
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
    const j=await r.json();const t=j.candidates?.[0]?.content?.parts?.[0]?.text;
    const out=JSON.parse(t);stats.replies++;return out;
   }catch(e){if(i===tries-1){stats.errors++;stats.lastError=e.message;throw e;}await sleep(1000*2**i);}
  }
  stats.errors++;stats.lastError='تجاوز حد الطلبات';throw new Error('تجاوز حد الطلبات');
 });
}
