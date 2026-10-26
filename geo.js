/* MAX public pages: condo coords, nearest station, room cards, auto-looping rows (shared by agent.html + room.html) */
(function(){
const SB='https://ekpavjlebbclapjdupwf.supabase.co',KEY=window.MAXGEO_KEY;
const ST=[['BTS','อ่อนนุช',13.7056,100.6009],['BTS','พระโขนง',13.7151,100.5916],['BTS','เอกมัย',13.7196,100.5852],['BTS','ทองหล่อ',13.7243,100.5792],['BTS','พร้อมพงษ์',13.7305,100.5697],['BTS','อโศก',13.7370,100.5604],['BTS','นานา',13.7405,100.5550],['BTS','เพลินจิต',13.7430,100.5490],['BTS','ชิดลม',13.7441,100.5430],['BTS','บางจาก',13.6968,100.6054],['BTS','ปุณณวิถี',13.6894,100.6089],['BTS','อุดมสุข',13.6799,100.6095],['BTS','บางนา',13.6683,100.6046],['BTS','แบริ่ง',13.6614,100.6017],['BTS','อารีย์',13.7797,100.5446],['BTS','สะพานควาย',13.7937,100.5497],['BTS','อนุสาวรีย์ชัยฯ',13.7627,100.5372],['BTS','พญาไท',13.7566,100.5339],['BTS','สยาม',13.7456,100.5341],['BTS','ศาลาแดง',13.7286,100.5343],['BTS','ช่องนนทรี',13.7236,100.5294],['MRT','สุขุมวิท',13.7378,100.5610],['MRT','เพชรบุรี',13.7486,100.5634],['MRT','พระราม 9',13.7576,100.5650],['MRT','ศูนย์สิริกิติ์',13.7230,100.5600],['MRT','ศูนย์วัฒนธรรม',13.7660,100.5700],['MRT','ห้วยขวาง',13.7785,100.5735],['MRT','สุทธิสาร',13.7893,100.5741],['MRT','รัชดาภิเษก',13.7990,100.5745],['MRT','ลุมพินี',13.7255,100.5455],['MRT','คลองเตย',13.7222,100.5537],['MRT','สามย่าน',13.7322,100.5297],['ARL','รามคำแหง',13.7429,100.6005],['ARL','มักกะสัน',13.7510,100.5610]];
const norm=p=>{const s=String(p||'');let k=s.replace(/\(.*?\)/g,'').replace(/[^\x00-\x7f]+/g,'').replace(/\s+/g,' ').trim().toLowerCase();return k||s.replace(/\s+/g,' ').trim().toLowerCase()};
const dist=(a,b,c,d)=>Math.hypot((d-b)*108000,(c-a)*110600);
let P=null;
async function coords(){if(P)return P;P={};try{const r=await fetch(SB+'/rest/v1/projects?select=key,name,lat,lng',{headers:{apikey:KEY,Authorization:'Bearer '+KEY}});(await r.json()).forEach(x=>P[x.key]=x)}catch(e){}return P}
function attach(rooms){rooms.forEach(r=>{const x=P&&P[norm(r.p)];if(x){r.lat=x.lat;r.lng=x.lng;r.cn=x.name;let b,bd=1e9;for(const s of ST){const d=dist(r.lat,r.lng,s[2],s[3]);if(d<bd){bd=d;b=s}}r.sl=b[0];r.sn=b[1];r.sm=Math.round(bd*1.25/50)*50}else{r.cn=String(r.p||'').replace(/\s*\(.*?\)/g,'').trim()}});return rooms}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-US');
const dtxt=m=>m<1000?m+' ม.':(m/1000).toFixed(1)+' กม.';
function card(r,href,mode){const pr=mode==='sale'?r.sale:r.rent;return '<a class="xc" href="'+esc(href)+'"><div class="xp" style="'+(r.cover?"background-image:url('"+esc(r.cover)+"')":'')+'"><span class="xb">ว่าง</span>'+(r.n?'<span class="xn">'+r.n+' รูป</span>':'')+'</div><div class="xi"><div class="xt">'+esc(r.cn||r.p||'ห้องให้เช่า')+'</div><div class="xs">'+esc([r.t,r.sz?r.sz+' ตร.ม.':''].filter(Boolean).join(' · '))+'</div><div class="xr">฿'+fmt(pr)+(mode==='sale'?'':' <small>/เดือน</small>')+'</div>'+(r.sl?'<div class="xx"><i class="'+r.sl+'">'+r.sl+'</i>'+esc(r.sn)+' '+dtxt(r.sm)+'</div>':'')+'</div></a>'}
const CSS='.xc{display:block;background:#fff;border-radius:16px;overflow:hidden;text-decoration:none;color:#1c1917;box-shadow:0 2px 10px rgba(60,30,10,.07)}.xp{position:relative;aspect-ratio:1/.82;background:linear-gradient(135deg,#cf7a56,#83401f) center/cover}.xb{position:absolute;top:8px;left:8px;background:#fff;color:#16a34a;font-size:11px;font-weight:600;padding:2px 9px;border-radius:10px}.xn{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:2px 7px;border-radius:9px}.xi{padding:8px 10px 10px}.xt{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xs{font-size:12px;color:#78716c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xr{color:#c2552d;font-weight:700;font-size:16px;margin-top:2px}.xr small{font-size:11px;color:#78716c;font-weight:400}.xx{font-size:11.5px;color:#57534e;margin-top:3px;display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden}.xx i{font-style:normal;background:#2e9e4f;color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:4px}.xx i.MRT{background:#1f4fa3}.xx i.ARL{background:#b91c1c}'
+'.mq{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:2px 16px 8px;scroll-padding:16px}.mq::-webkit-scrollbar{display:none}.mq>.xc{flex:0 0 160px}@media(min-width:700px){.mq>.xc{flex-basis:200px}}';
const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
/* infinite auto-scroll row; pauses on touch/drag/wheel, resumes after idle */
function loop(el,speed){speed=speed||0.35;const items=el.innerHTML;let paused=0,last=0,pos=0,half=0,raf;
 const setup=()=>{if(el.dataset.dup)return;if(el.scrollWidth<=el.clientWidth+8)return;el.innerHTML=items+items;el.dataset.dup=1;el.querySelectorAll('.xc').forEach((a,i,all)=>{if(i>=all.length/2)a.setAttribute('aria-hidden','true')});half=el.scrollWidth/2};
 setup();if(!el.dataset.dup)return;
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const pause=()=>{paused=Date.now()+1e9};const resume=()=>{paused=Date.now()+2500};
 el.addEventListener('pointerdown',pause,{passive:true});el.addEventListener('touchstart',pause,{passive:true});
 ['pointerup','pointercancel','touchend','touchcancel','mouseleave'].forEach(e=>el.addEventListener(e,resume,{passive:true}));
 el.addEventListener('wheel',()=>{paused=Date.now()+2500},{passive:true});
 el.addEventListener('mouseenter',()=>{paused=Date.now()+1e9});
 pos=el.scrollLeft;
 const tick=t=>{raf=requestAnimationFrame(tick);if(!el.isConnected){cancelAnimationFrame(raf);return}const dt=last?Math.min(t-last,50):16;last=t;
  if(Date.now()<paused){pos=el.scrollLeft;return}
  if(el.getBoundingClientRect().bottom<0||el.getBoundingClientRect().top>innerHeight)return;
  half=el.scrollWidth/2;pos+=speed*dt/16;if(pos>=half)pos-=half;el.scrollLeft=pos;
  if(Math.abs(el.scrollLeft-pos)>2)pos=el.scrollLeft};
 el.addEventListener('scroll',()=>{if(Date.now()<paused){if(el.scrollLeft>=half)el.scrollLeft-=half;else if(el.scrollLeft<=0)el.scrollLeft+=half}},{passive:true});
 raf=requestAnimationFrame(tick)}
window.MAXGEO={norm,dist,coords,attach,card,loop,esc,fmt,dtxt,SB};
})();
