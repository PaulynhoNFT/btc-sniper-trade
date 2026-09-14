// Historical adapter: higher-timeframe bars are only published at their close.
const fs=require('fs'),E=require('./engine.js');
const input=JSON.parse(fs.readFileSync(0,'utf8')), rows=input.rows,profile=input.profile,ms={'1d':86400000,'4h':14400000,'1h':3600000,'15m':900000,'5m':300000};
const cfg=E.profiles[profile],states=cfg.frames.map(()=>({bars:[],current:null,analysis:null})),out=[];
for(const row of rows){const closeTime=row.t+input.step;
 states.forEach((s,i)=>{const duration=ms[cfg.frames[i]],bucket=Math.floor(row.t/duration)*duration;
  if(!s.current||s.current.t!==bucket)s.current={...row,t:bucket};else {s.current.h=Math.max(s.current.h,row.h);s.current.l=Math.min(s.current.l,row.l);s.current.c=row.c;s.current.v+=row.v}
  if(closeTime===bucket+duration){s.bars.push(s.current);if(s.bars.length>500)s.bars.shift();s.analysis=E.analyze(s.bars);s.current=null}
 });
 if(states.every(s=>s.analysis)){const r=E.evaluate(states.map(s=>s.analysis),profile,{price:row.c});out.push({t:row.t,signal:r.technical?r.dir:0,score:r.score,distance:r.frames[2].atr*cfg.atr/row.c,atr:r.frames[2].atr/row.c})}else out.push({t:row.t,signal:0,score:0,distance:0,atr:0});
}
process.stdout.write(JSON.stringify(out));
