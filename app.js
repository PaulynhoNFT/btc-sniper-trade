'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const fmt=(x,d=2)=>Number.isFinite(x)?x.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
let result=null,candles=[],busy=false,lastUpdate=0;
let journal=[];try{journal=JSON.parse(localStorage.getItem('elderJournalV1')||'[]');if(!Array.isArray(journal))journal=[]}catch{}
function save(){try{localStorage.setItem('elderJournalV1',JSON.stringify(journal))}catch{$('#connection').textContent='Armazenamento local indisponível'}}
async function request(path){const r=await fetch('https://api.binance.com/api/v3/'+path,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Binance HTTP '+r.status);return r.json()}
const minutes={ '1d':1440,'4h':240,'1h':60,'15m':15,'5m':5 };
async function bars(tf,now){const rows=await request(`klines?symbol=BTCUSDT&interval=${tf}&limit=500`);const b=rows.filter(x=>x[6]<now).map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));if(b.length<160||b.some((x,i)=>!Object.values(x).every(Number.isFinite)||(i&&x.t-b[i-1].t!==minutes[tf]*60000)))throw Error('Candles inválidos ou incompletos');return b}
function render(){
 $('#decision').textContent=result?.valid?(result.dir===1?'COMPRAR':'VENDER'):'AGUARDAR';
 $('#decisionText').textContent=result?.valid?'Configuração confirmada.':'Análise técnica disponível; entradas dependem de todas as confirmações.';
 $('#score').textContent=result?.score??'—';$('#meter').style.width=(result?.score||0)+'%';
 for(const key of ['entry','stop','tp1','tp2','tp3'])$('#'+key).textContent=result?.valid?'$'+fmt(result.levels[key]):'—';
 $('#checks').replaceChildren();for(const [name,ok] of result?.checks||[]){const div=document.createElement('div');div.className='check';const s=document.createElement('span');s.textContent=name;const b=document.createElement('b');b.className=ok?'ok':'no';b.textContent=ok?'OK':'AGUARDAR';div.append(s,b);$('#checks').append(div)}
 $('#vetoes').replaceChildren();for(const reason of result?.reasons||['Carregando dados']){const li=document.createElement('li');li.textContent=reason;$('#vetoes').append(li)}
 $('#tfCards').replaceChildren();for(const [i,f] of (result?.frames||[]).entries()){const div=document.createElement('div');div.className='tf';div.textContent=`Tela ${i+1} · ${Elder.profiles[$('#profile').value].frames[i]} · EMA13 $${fmt(f.ema)} · ADX ${fmt(f.adx,1)} · RSI ${fmt(f.rsi,1)}`;$('#tfCards').append(div)}
 draw();
}
async function refresh(){if(busy)return;busy=true;$('#profile').disabled=true;try{
 const now=Date.now(),profile=$('#profile').value,cfg=Elder.profiles[profile];
 const [frames,ticker,book]=await Promise.all([Promise.all(cfg.frames.map(tf=>bars(tf,now))),request('ticker/24hr?symbol=BTCUSDT'),request('ticker/bookTicker?symbol=BTCUSDT')]);
 const price=+ticker.lastPrice,spread=(+book.askPrice- +book.bidPrice)/price;
 if(!(price>0)||!(spread>=0))throw Error('Cotação inválida');
 const fresh=frames.every((b,i)=>now-b.at(-1).t-minutes[cfg.frames[i]]*60000<minutes[cfg.frames[i]]*60000+60000);
 result=Elder.evaluate(frames,profile,{price,spread,fresh,macroVerified:false,macroBlackout:null,derivativesConfirmed:false,riskAllowed:false});
 candles=frames[2];lastUpdate=Date.now();$('#price').textContent='$'+fmt(price);$('#volume').textContent=fmt(+ticker.quoteVolume/1e9)+'B USDT';$('#change').textContent=fmt(+ticker.priceChangePercent)+'%';$('#atr').textContent='$'+fmt(result.frames?.[2].atr);$('#updated').textContent=new Date(lastUpdate).toLocaleTimeString('pt-BR');$('#connection').textContent='Binance · candles encerrados';$('.live').classList.add('ready');render();
 }catch(e){candles=[];result={valid:false,score:0,reasons:['Falha ou dados desatualizados: '+e.message],checks:[]};$('.live').classList.remove('ready');$('#connection').textContent='Dados indisponíveis';render()}finally{busy=false;$('#profile').disabled=false}}
function draw(){
 const canvas=$('#strategyChart'),ctx=canvas.getContext('2d'),width=canvas.clientWidth,height=400,dpr=devicePixelRatio||1;canvas.width=width*dpr;canvas.height=height*dpr;ctx.scale(dpr,dpr);ctx.fillStyle='#090c12';ctx.fillRect(0,0,width,height);
 const b=candles.slice(-Number($('#zoom').value||120));if(!b.length)return;
 const levels=result?.technical?result.levels:null;const vals=b.flatMap(x=>[x.h,x.l]).concat(levels?Object.values(levels):[]),lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo)*.08||1,y=v=>height-30-(v-lo+pad)/(hi-lo+pad*2)*(height-60),step=(width-90)/b.length;
 ctx.font='11px system-ui';for(let i=0;i<5;i++){const value=lo+(hi-lo)*i/4;ctx.strokeStyle='#222a38';ctx.beginPath();ctx.moveTo(0,y(value));ctx.lineTo(width-80,y(value));ctx.stroke();ctx.fillStyle='#8490a3';ctx.fillText(fmt(value),width-78,y(value))}
 b.forEach((c,i)=>{const x=8+i*step;ctx.strokeStyle=ctx.fillStyle=c.c>=c.o?'#22c77a':'#ff5263';ctx.beginPath();ctx.moveTo(x,y(c.h));ctx.lineTo(x,y(c.l));ctx.stroke();ctx.fillRect(x-step*.3,Math.min(y(c.o),y(c.c)),Math.max(1,step*.6),Math.max(1,Math.abs(y(c.o)-y(c.c))))});
 let ema=candles[0].c;const es=candles.map(c=>ema=c.c*2/14+ema*12/14).slice(-b.length);ctx.strokeStyle='#f7b731';ctx.beginPath();es.forEach((v,i)=>i?ctx.lineTo(8+i*step,y(v)):ctx.moveTo(8,y(v)));ctx.stroke();
 if(levels)for(const [key,v] of Object.entries(levels)){ctx.strokeStyle=key==='stop'?'#ff5263':'#6c8cff';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(0,y(v));ctx.lineTo(width-85,y(v));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=ctx.strokeStyle;ctx.fillText(key.toUpperCase(),8,y(v)-4)}
 ctx.fillStyle='#8490a3';ctx.fillText(new Date(b[0].t).toLocaleString('pt-BR'),8,height-8);$('#chartCaption').textContent=levels?'Candles encerrados · EMA13 dourada · níveis técnicos ilustrativos; não são sinal autorizado':'Candles encerrados · EMA13 dourada · sem setup técnico válido para traçar alvos';
}
function showJournal(){ $('#totalTrades').textContent=journal.length;$('#wins').textContent='—';$('#losses').textContent='—';$('#journalRows').replaceChildren();for(const r of journal.slice(0,100)){const d=document.createElement('div');d.className='journal-row';d.textContent=`${r.time} · ${r.version} · ${r.profile} · ${r.valid?'Sinal':'Observação'} · score ${r.score}`;$('#journalRows').append(d)}}
$('#saveSignal').onclick=()=>{if(!result?.frames||Date.now()-lastUpdate>60000)return; journal.unshift({time:new Date().toISOString(),version:Elder.VERSION,profile:result.profile,valid:result.valid,score:result.score,levels:result.technical?result.levels:null,checks:result.checks});save();showJournal()};
$('#calculate').onclick=()=>{const capital=+$('#capital').value,p=+$('#riskPct').value,max=Elder.profiles[$('#profile').value].risk*100;if(!(capital>0&&p>0&&p<=max)){$('#positionSize').textContent=`Risco permitido: até ${max}%`;return}$('#riskAmount').textContent='$'+fmt(capital*p/100);$('#positionSize').textContent=result?.valid&&Date.now()-lastUpdate<60000?fmt(capital*p/100/Math.abs(result.levels.entry-result.levels.stop),6)+' BTC':'Aguardando sinal'};
$$('.nav').forEach(b=>b.onclick=()=>{$$('.nav,.view').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.view).classList.add('active');draw()});
$('#profile').onchange=()=>{result=null;candles=[];$('#riskPct').value=Elder.profiles[$('#profile').value].risk*100;render();refresh()};$('#zoom').onchange=draw;new ResizeObserver(draw).observe($('#strategyChart'));
showJournal();refresh();setInterval(()=>{if(Date.now()-lastUpdate>60000&&result?.valid){result.valid=false;render()}refresh()},30000);
