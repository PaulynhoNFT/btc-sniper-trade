/* Shared browser/Node engine. Only CLOSED candles may enter this module. */
(function(root){
'use strict';
const VERSION='elder-1.0.0';
const profiles={swing:{frames:['1d','4h','1h'],risk:.01,atr:1.5,spread:.003},scalp:{frames:['1h','15m','5m'],risk:.005,atr:1,spread:.001}};
const last=a=>a.at(-1), mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
function ema(a,p){let v=a[0];return a.map((x,i)=>v=i?x*2/(p+1)+v*(1-2/(p+1)):x)}
function rma(a,p){let v=0;return a.map((x,i)=>{if(i<p){v+=x;return i===p-1?(v/=p):NaN}return v=(v*(p-1)+x)/p})}
function quantile(a,q){a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a[Math.floor((a.length-1)*q)]}
function analyze(b){
 if(b.length<160)return null;
 const c=b.map(x=>x.c),h=b.map(x=>x.h),l=b.map(x=>x.l),e=ema(c,13),fast=ema(c,12),slow=ema(c,26),mac=fast.map((v,i)=>v-slow[i]),sig=ema(mac,9),hist=mac.map((v,i)=>v-sig[i]);
 const tr=[],plus=[],minus=[],g=[],loss=[];
 for(let i=1;i<b.length;i++){tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));let up=h[i]-h[i-1],dn=l[i-1]-l[i];plus.push(up>dn&&up>0?up:0);minus.push(dn>up&&dn>0?dn:0);g.push(Math.max(0,c[i]-c[i-1]));loss.push(Math.max(0,c[i-1]-c[i]))}
 const atr=rma(tr,14),pd=rma(plus,14),md=rma(minus,14),dx=pd.map((v,i)=>100*Math.abs(v-md[i])/(v+md[i]||1)),ad=rma(dx.slice(13),14),gg=rma(g,14),ll=rma(loss,14),rs=gg.map((v,i)=>v===0&&ll[i]===0?50:ll[i]===0?100:100-100/(1+v/ll[i]));
 const raw=b.map((x,i)=>{if(i<13)return NaN;let hi=Math.max(...h.slice(i-13,i+1)),lo=Math.min(...l.slice(i-13,i+1));return hi===lo?50:100*(x.c-lo)/(hi-lo)}),k=raw.map((_,i)=>mean(raw.slice(Math.max(0,i-2),i+1))),d=k.map((_,i)=>mean(k.slice(Math.max(0,i-2),i+1)));
 const widths=c.map((v,i)=>{if(i<19)return NaN;let w=c.slice(i-19,i+1),m=mean(w);return 4*Math.sqrt(mean(w.map(z=>(z-m)**2)))/m});
 const x=last(b),p=b.at(-2),a=last(atr),support=Math.min(...l.slice(-21,-1)),resistance=Math.max(...h.slice(-21,-1)),fibs=[.382,.5,.618].map(f=>resistance-(resistance-support)*f);
 const near=level=>x.l<=level+.25*a&&x.h>=level-.25*a;
 const range=x.h-x.l,body=Math.abs(x.c-x.o),lower=Math.min(x.o,x.c)-x.l,upper=x.h-Math.max(x.o,x.c);
 const bull=(x.c>x.o&&p.c<p.o&&x.c>=p.o&&x.o<=p.c)||(x.c>x.o&&lower>=2*body&&upper<=body&&body>0);
 const bear=(x.c<x.o&&p.c>p.o&&x.o>=p.c&&x.c<=p.o)||(x.c<x.o&&upper>=2*body&&lower<=body&&body>0);
 const direction=x.c>last(e)&&last(mac)>0&&last(hist)>hist.at(-2)?1:x.c<last(e)&&last(mac)<0&&last(hist)<hist.at(-2)?-1:0;
 return {x,p,ema:last(e),mac:last(mac),hist:last(hist),adx:last(ad),atr:a,rsi:last(rs),prevRsi:rs.at(-2),k:last(k),d:last(d),prevK:k.at(-2),prevD:d.at(-2),bullPower:x.h-last(e),bearPower:x.l-last(e),direction,volume:x.v/mean(b.slice(-21,-1).map(z=>z.v)),zoneLong:near(support)||near(last(e))||fibs.some(near),zoneShort:near(resistance)||near(last(e))||fibs.some(near),bull,bear,macUp:mac.at(-2)<=sig.at(-2)&&last(mac)>last(sig),macDown:mac.at(-2)>=sig.at(-2)&&last(mac)<last(sig),breakUp:x.c>resistance,breakDown:x.c<support,atrOK:a>=quantile(atr.slice(-101,-1),.2)&&a<=quantile(atr.slice(-101,-1),.8),bbOK:last(widths)>quantile(widths.slice(-101,-1),.2)&&last(widths)<=quantile(widths.slice(-101,-1),.8),support,resistance,range};
}
function evaluate(frames,profile='swing',context={}){
 const cfg=profiles[profile], [t,c,e]=frames.map(f=>Array.isArray(f)?analyze(f):f),checks=[],reasons=[];
 const check=(name,ok)=>{checks.push([name,!!ok]);if(!ok)reasons.push(name);return ok};
 if(!t||!c||!e)return {version:VERSION,valid:false,technical:false,score:0,checks:[],reasons:['Histórico insuficiente: mínimo 160 candles por tela']};
 const dir=t.direction,zone=dir===1?c.zoneLong:c.zoneShort;
 const correction=dir===1?(c.rsi<30||c.k<20||c.bearPower<0):(c.rsi>70||c.k>80||c.bullPower>0);
 const pattern=dir===1?e.bull:e.bear;
 const triggers=[dir===1?e.macUp:e.macDown,dir===1?e.prevRsi<=30&&e.rsi>30:e.prevRsi>=70&&e.rsi<70,dir===1?e.prevK<=e.prevD&&e.k>e.d:e.prevK>=e.prevD&&e.k<e.d,pattern,(dir===1?e.breakUp:e.breakDown)&&e.volume>1];
 const hits=triggers.filter(Boolean).length;
 const score=(dir?(t.adx>=25?25:15):0)+(correction&&zone?20:0)+(hits>=3?20:0)+(e.volume>1?10:0)+(pattern?10:0)+(zone?10:0)+5;
 check('Tela 1: EMA13, MACD e inclinação do histograma alinhados',dir!==0);
 check('ADX ≥ 20',t.adx>=20);check('Tela 2: correção em zona técnica',correction&&zone);
 check('Tela 3: pelo menos 3 dos 5 gatilhos',hits>=3);
 check('ATR entre percentis 20 e 80',e.atrOK);check('Bollinger fora de compressão/expansão extrema',e.bbOK);
 check(`Score mínimo ${t.adx<25?80:70}`,score>=(t.adx<25?80:70));
 const price=context.price??e.x.c;
 check('Preço a no máximo 1 ATR do gatilho',Math.abs(price-e.x.c)<=e.atr);
 const risk=cfg.atr*e.atr, levels={entry:price,stop:price-dir*risk,tp1:price+dir*risk,tp2:price+dir*2*risk,tp3:price+dir*3*risk};
 check('Distância de stop e preços válidos',risk>0&&Object.values(levels).every(x=>Number.isFinite(x)&&x>0));
 const technical=reasons.length===0;
 check('Dados recentes e candles encerrados',context.fresh===true);
 check('Spread dentro do limite do perfil',Number.isFinite(context.spread)&&context.spread<=cfg.spread);
 check('Calendário macro verificado, fora da janela ±15 min',context.macroVerified===true&&context.macroBlackout===false);
 check('Confirmação de derivativos disponível',context.derivativesConfirmed===true);
 check('Limites de perda, cooldown e frequência liberados',context.riskAllowed===true);
 return {version:VERSION,profile,valid:reasons.length===0,technical,score,dir,levels,checks,reasons,hits,frames:[t,c,e],signalTime:e.x.t,riskPct:cfg.risk};
}
const api={VERSION,profiles,analyze,evaluate};if(typeof module!=='undefined')module.exports=api;root.Elder=api;
})(typeof globalThis!=='undefined'?globalThis:this);
