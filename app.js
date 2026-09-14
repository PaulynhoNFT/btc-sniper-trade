const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={price:0,atr:0,decision:'AGUARDAR',score:0,side:null,levels:{},frames:{},checks:[]};
const fmt=(n,d=2)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
function ema(values,p){const k=2/(p+1);return values.reduce((a,v,i)=>i?v*k+a*(1-k):v,values[0])}
function rsi(v,p=14){let g=0,l=0;for(let i=v.length-p;i<v.length;i++){const d=v[i]-v[i-1];d>0?g+=d:l-=d}return l?100-(100/(1+g/l)):100}
function calc(candles,label){const c=candles.map(x=>+x[4]),h=candles.map(x=>+x[2]),l=candles.map(x=>+x[3]),vol=candles.map(x=>+x[5]);const e20=ema(c.slice(-60),20),e50=ema(c.slice(-80),50),last=c.at(-1),prev=c.at(-2);const tr=h.slice(-15).map((x,i)=>Math.max(x-l.at(i-15),Math.abs(x-c.at(i-16)),Math.abs(l.at(i-15)-c.at(i-16))));const atr=tr.reduce((a,b)=>a+b,0)/tr.length;const avgV=vol.slice(-21,-1).reduce((a,b)=>a+b,0)/20;const trend=last>e20&&e20>e50?'ALTA':last<e20&&e20<e50?'BAIXA':'NEUTRA';return{label,last,e20,e50,atr,rsi:rsi(c),volumeRatio:vol.at(-1)/avgV,trend,closedUp:last>prev}}
async function klines(interval,limit=120){const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);if(!r.ok)throw Error('Binance indisponível');return r.json()}
async function refresh(){
 try{
  const [ticker,m15,h4,d1]=await Promise.all([fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT').then(r=>r.json()),klines('15m'),klines('4h'),klines('1d')]);
  const a=calc(m15,'15M'),b=calc(h4,'4H'),c=calc(d1,'1D');state.price=+ticker.lastPrice;state.atr=a.atr;state.frames={a,b,c};
  const aligned=b.trend===c.trend&&b.trend!=='NEUTRA';const execution=a.trend===b.trend;const volume=a.volumeRatio>=1.5;const momentum=(b.trend==='ALTA'&&a.rsi>50&&a.rsi<72)||(b.trend==='BAIXA'&&a.rsi<50&&a.rsi>28);
  state.checks=[['Tendência 4H + 1D alinhada',aligned],['Execução 15M a favor da tendência',execution],['EMA 20 / 50 confirmada',a.trend!=='NEUTRA'],['Volume ≥ 1,5× média',volume],[`RSI 14 saudável (${a.rsi.toFixed(1)})`,momentum]];
  state.score=[aligned,execution,a.trend!=='NEUTRA',volume,momentum].filter(Boolean).length*16;
  const unavailable=true; // derivatives + macro require verified server feeds
  const valid=state.score>=70&&!unavailable;
  state.decision=valid?(b.trend==='ALTA'?'COMPRAR':'VENDER'):'AGUARDAR';state.side=valid?b.trend:null;
  const risk=a.atr*1.5,dir=state.side==='BAIXA'?-1:1;state.levels={entry:state.price,stop:state.price-dir*risk,tp1:state.price+dir*risk,tp2:state.price+dir*risk*2,tp3:state.price+dir*risk*3};
  $('#price').textContent='$'+fmt(state.price);const ch=+ticker.priceChangePercent;$('#change').textContent=(ch>=0?'+':'')+ch.toFixed(2)+'% em 24h';$('#change').className=ch>=0?'positive':'negative';
  $('#volume').textContent=fmt(+ticker.quoteVolume/1e9,2)+'B';$('#atr').textContent='$'+fmt(a.atr);$('#updated').textContent=new Date().toLocaleTimeString('pt-BR');
  $('.live').classList.add('ready');$('#connection').textContent='Binance ao vivo';render();
 }catch(e){$('#connection').textContent='Falha ao atualizar';$('#decisionText').textContent='Dados indisponíveis. Nenhuma nova entrada pode ser liberada.'}
}
function render(){
 $('#decision').textContent=state.decision;$('#score').textContent=state.score;$('#meter').style.width=state.score+'%';
 $('#decisionText').textContent=state.decision==='AGUARDAR'?'Nenhuma entrada Sniper confirmada. Qualidade acima de quantidade.':'Configuração confirmada pelo motor.';
 for(const k of ['entry','stop','tp1','tp2','tp3'])$('#'+k).textContent=state.side?'$'+fmt(state.levels[k]):'—';
 $('#checks').innerHTML=state.checks.map(([n,v])=>`<div class="check"><span>${n}</span><b class="${v?'ok':'no'}">${v?'CONFIRMADO':'NÃO CONFIRMADO'}</b></div>`).join('');
 const veto=state.checks.filter(x=>!x[1]).map(x=>x[0]);veto.push('Open Interest, funding e contexto macro ainda sem fonte verificada');
 $('#vetoes').innerHTML=veto.map(x=>`<li>${x}</li>`).join('');
 $('#tfCards').innerHTML=Object.values(state.frames).map(f=>`<div class="tf"><span class="eyebrow">${f.label}</span><strong class="${f.trend==='ALTA'?'positive':f.trend==='BAIXA'?'negative':''}">${f.trend}</strong><small>EMA20 $${fmt(f.e20)} · RSI ${f.rsi.toFixed(1)}</small></div>`).join('');
}
$$('.nav').forEach(b=>b.onclick=()=>{$$('.nav,.view').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.view).classList.add('active')});
$('#calculate').onclick=()=>{const cap=+$('#capital').value,p=+$('#riskPct').value,amt=cap*p/100;$('#riskAmount').textContent='$'+fmt(amt);$('#positionSize').textContent=state.side&&Math.abs(state.levels.entry-state.levels.stop)>0?fmt(amt/Math.abs(state.levels.entry-state.levels.stop),5)+' BTC':'Aguardando sinal'};
function journal(){const rows=JSON.parse(localStorage.getItem('btcSniperJournal')||'[]');$('#totalTrades').textContent=rows.length;$('#wins').textContent=rows.filter(x=>x.result==='gain').length;$('#losses').textContent=rows.filter(x=>x.result==='loss').length;$('#journalRows').innerHTML=rows.length?rows.map(x=>`<div class="journal-row"><span>${x.date}</span><b>${x.decision}</b><span>$${fmt(x.price)}</span><span>Score ${x.score}</span></div>`).join(''):'Nenhum snapshot salvo neste navegador.'}
$('#saveSignal').onclick=()=>{const rows=JSON.parse(localStorage.getItem('btcSniperJournal')||'[]');rows.unshift({date:new Date().toLocaleString('pt-BR'),decision:state.decision,price:state.price,score:state.score});localStorage.setItem('btcSniperJournal',JSON.stringify(rows.slice(0,100)));journal()};journal();refresh();setInterval(refresh,30000);