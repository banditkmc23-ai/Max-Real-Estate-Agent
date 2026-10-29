/* MAX public pages: condo coords, nearest station, room cards, swipe rows (shared by agent.html + room.html) */
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
/* ---- TH/EN language layer (shared by agent.html + room.html). Choice kept in localStorage 'max_lang'; default Thai ---- */
let LANG='th';try{LANG=localStorage.getItem('max_lang')==='en'?'en':'th'}catch(e){}
document.documentElement.lang=LANG;
const subs=[];
const lang=()=>LANG,en=()=>LANG==='en',t=(a,b)=>LANG==='en'?b:a;
function setLang(l){LANG=l==='en'?'en':'th';try{localStorage.setItem('max_lang',LANG)}catch(e){}document.documentElement.lang=LANG;subs.forEach(f=>{try{f()}catch(e){console.warn(e)}})}
const onLang=f=>subs.push(f);
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-lang]');if(b){e.stopPropagation();e.preventDefault();if(b.dataset.lang!==LANG)setLang(b.dataset.lang)}},true);
const sw=()=>'<span class="lsw" role="group" aria-label="Language"><button type="button" data-lang="th" class="'+(LANG==='th'?'on':'')+'" aria-pressed="'+(LANG==='th')+'">ไทย</button><button type="button" data-lang="en" class="'+(LANG==='en'?'on':'')+'" aria-pressed="'+(LANG==='en')+'">EN</button></span>';
const TH=/[\u0E00-\u0E7F]/,LAT=/[A-Za-z]/;
/* project / condo names are never translated: always the English name (Thai part in parentheses or inline is dropped) */
function pname(p){const s=String(p||'').trim();if(!s||!TH.test(s))return s;
  const groups=[...s.matchAll(/\(([^)]*)\)/g)].map(m=>m[1].trim());const out=s.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  if(!TH.test(out)&&LAT.test(out))return out;
  const g=groups.find(x=>LAT.test(x)&&!TH.test(x)&&x.length>=3);if(g)return g;
  const o2=out.replace(/[\u0E00-\u0E7F]+/g,' ').replace(/\s+/g,' ').replace(/^[\s\-–·,]+|[\s\-–·,]+$/g,'').trim();
  return (o2.match(/[A-Za-z]/g)||[]).length>=3?o2:s}
const nameOf=r=>{const a=pname(r.p),b=pname(r.cn);return LAT.test(a)?a:(LAT.test(b)?b:(r.cn||r.p||''))};
const STN={'อ่อนนุช':'On Nut','พระโขนง':'Phra Khanong','เอกมัย':'Ekkamai','ทองหล่อ':'Thong Lo','พร้อมพงษ์':'Phrom Phong','อโศก':'Asok','นานา':'Nana','เพลินจิต':'Phloen Chit','ชิดลม':'Chit Lom','บางจาก':'Bang Chak','ปุณณวิถี':'Punnawithi','อุดมสุข':'Udom Suk','บางนา':'Bang Na','แบริ่ง':'Bearing','อารีย์':'Ari','สะพานควาย':'Saphan Khwai','อนุสาวรีย์ชัยฯ':'Victory Monument','พญาไท':'Phaya Thai','สยาม':'Siam','ศาลาแดง':'Sala Daeng','ช่องนนทรี':'Chong Nonsi','สุขุมวิท':'Sukhumvit','เพชรบุรี':'Phetchaburi','พระราม 9':'Phra Ram 9','พระราม9':'Phra Ram 9','พระราม':'Phra Ram 9','ศูนย์สิริกิติ์':'Queen Sirikit Convention Centre','ศูนย์ประชุมสิริกิติ์':'Queen Sirikit Convention Centre','ศูนย์วัฒนธรรม':'Thailand Cultural Centre','ห้วยขวาง':'Huai Khwang','สุทธิสาร':'Sutthisan','รัชดาภิเษก':'Ratchadaphisek','ลุมพินี':'Lumphini','คลองเตย':'Khlong Toei','สามย่าน':'Sam Yan','รามคำแหง':'Ramkhamhaeng','มักกะสัน':'Makkasan','สุรศักดิ์':'Surasak'};
const STK=Object.keys(STN).sort((a,b)=>b.length-a.length);
const STT={'onnut':'อ่อนนุช','on nut':'อ่อนนุช','on':'อ่อนนุช','phrakhanong':'พระโขนง','ekkamai':'เอกมัย','thonglor':'ทองหล่อ','thong lo':'ทองหล่อ','phrom phong':'พร้อมพงษ์','phromphong':'พร้อมพงษ์','asok':'อโศก','asoke':'อโศก','nana':'นานา','phloen chit':'เพลินจิต','ploenchit':'เพลินจิต','chit lom':'ชิดลม','chidlom':'ชิดลม'};
function stn(sn){const m=String(sn||'').trim().match(/^(BTS|MRT|ARL|Airport Link)?\s*(.*)$/i);const b=m[1]?m[1].toUpperCase().replace('AIRPORT LINK','ARL'):'',n=m[2].trim();let o=n;
  if(en()){const k=STK.find(k=>n.startsWith(k));if(k)o=STN[k]}else if(!TH.test(n)){const k=STT[n.toLowerCase()];if(k)o=k}
  return{b,n:o,full:(b?b+' ':'')+o}}
const stFull=sn=>stn(sn).full;
const dtxt=m=>m<1000?m+t(' ม.',' m'):(m/1000).toFixed(1)+t(' กม.',' km');
const typeOf=v=>{let s=String(v||'');if(!s)return'';if(en())return s.replace(/(\d+)\s*Bed(?:room)?s?/ig,(x,n)=>n+(n==='1'?' Bedroom':' Bedrooms')).replace(/ห้องนอน/g,'Bedroom').replace(/สตูดิโอ/g,'Studio');return s.replace(/(\d+)\s*Bed(?:room)?s?/ig,'$1 ห้องนอน').replace(/Studio/ig,'สตูดิโอ').replace(/Duplex/ig,'ดูเพลกซ์')};
const bathOf=n=>n?(en()?n+(String(n)==='1'?' bathroom':' bathrooms'):n+' ห้องน้ำ'):'';
const VW_EN=[['วิวเมืองโล่ง','Open city view'],['วิวเมือง','City view'],['วิวสระว่ายน้ำ','Pool view'],['วิวสระ','Pool view'],['สระว่ายน้ำ','Pool view'],['วิวสวนลุมพินี','Lumphini Park view'],['วิวสวนเบญจสิริ','Benjasiri Park view'],['วิวสวนมักกะสัน','Makkasan Park view'],['วิวสวน','Garden view'],['วิวทางด่วน','Expressway view'],['วิวสวยสบายตา','Pleasant view'],['วิวสวย','Nice view'],['วิวดี','Good view'],['วิวโล่ง','Open view'],['วิวโปร่ง','Open view'],['โปร่งสบาย','airy'],['ไม่มีตึกบัง','no blocking buildings'],['ไม่มีอาคารบัง','no blocking buildings'],['ไม่บล็อก','unblocked'],['วิวไม่บล็อก','unblocked view'],['ชั้นสูง','High floor'],['ห้องมุม','corner unit'],['ทิศตะวันออกเฉียงเหนือ','Northeast-facing'],['ทิศตะวันออก','East-facing'],['ทิศตะวันตก','West-facing'],['ทิศเหนือ','North-facing'],['ทิศใต้','South-facing'],['ห้องทิศใต้','South-facing'],['ระเบียงหันถนนเพชรบุรี','Balcony facing Phetchaburi Road'],['และตึก','& buildings'],['และ','and'],['วิว','View']];
VW_EN.sort((a,b)=>b[0].length-a[0].length);
const VW_TH=[[/^(west)\s+cit(y|i)(\s*view)?$/i,'วิวเมือง ทิศตะวันตก'],[/^cit(y|i)\s*view\s*\/\s*panoramic$/i,'วิวเมือง / พาโนรามา'],[/^cit(y|i)(\s*view)?$/i,'วิวเมือง'],[/^pool(\s*view)?$/i,'วิวสระว่ายน้ำ']];
function viewOf(v){let s=String(v||'').trim();if(!s)return'';
  if(en()){if(!TH.test(s))return s;const g=s.match(/\(([^)]*[A-Za-z]{3}[^)]*)\)/);if(g&&!TH.test(g[1]))return g[1].trim();
    VW_EN.forEach(([a,b])=>{s=s.split(a).join(' '+b+' ')});s=s.replace(/\s+/g,' ').replace(/\(\s+/g,'(').replace(/\s+\)/g,')').replace(/\s*\/\s*/g,' / ').trim();return s.charAt(0).toUpperCase()+s.slice(1)}
  for(const[r,x]of VW_TH)if(r.test(s))return x;return s}
const TML={'สัญญาขั้นต่ำ':'Minimum lease','ล่วงหน้า':'Advance payment','เงินประกัน':'Security deposit'};
const tmLabel=k=>en()?(TML[k]||k):k;
const tmVal=v=>{if(!en())return v;return String(v).replace(/(\d+)\s*(ปี|เดือน)/g,(x,n,u)=>n+' '+(u==='ปี'?'year':'month')+(n==='1'?'':'s'))};
function card(r,href,mode){const pr=mode==='sale'?r.sale:r.rent,S=stn(r.sn||'');return '<a class="xc" href="'+esc(href)+'"><div class="xp" style="'+(r.cover?"background-image:url('"+esc(r.cover)+"')":'')+'"><span class="xb">'+t('ว่าง','Available')+'</span>'+(r.n?'<span class="xn">'+r.n+t(' รูป',r.n==1?' photo':' photos')+'</span>':'')+'</div><div class="xi"><div class="xt">'+esc(nameOf(r)||t('ห้องให้เช่า','Room for rent'))+'</div><div class="xs">'+esc([typeOf(r.t),r.sz?r.sz+t(' ตร.ม.',' sqm'):''].filter(Boolean).join(' · '))+'</div><div class="xr">฿'+fmt(pr)+(mode==='sale'?'':' <small>'+t('/เดือน','/ month')+'</small>')+'</div>'+(r.sl?'<div class="xx"><i class="'+r.sl+'">'+r.sl+'</i>'+esc(S.n)+' '+dtxt(r.sm)+'</div>':'')+'</div></a>'}
const CSS='.xc{display:block;background:#fff;border-radius:16px;overflow:hidden;text-decoration:none;color:#1c1917;box-shadow:0 2px 10px rgba(60,30,10,.07)}.xp{position:relative;aspect-ratio:1/.82;background:linear-gradient(135deg,#cf7a56,#83401f) center/cover}.xb{position:absolute;top:8px;left:8px;background:#fff;color:#16a34a;font-size:11px;font-weight:600;padding:2px 9px;border-radius:10px}.xn{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:2px 7px;border-radius:9px}.xi{padding:8px 10px 10px}.xt{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xs{font-size:12px;color:#78716c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xr{color:#c2552d;font-weight:700;font-size:16px;margin-top:2px}.xr small{font-size:11px;color:#78716c;font-weight:400}.xx{font-size:11.5px;color:#57534e;margin-top:3px;display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden}.xx i{font-style:normal;background:#2e9e4f;color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:4px}.xx i.MRT{background:#1f4fa3}.xx i.ARL{background:#b91c1c}'
+'.mq{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:2px 16px 8px;scroll-padding:16px}.mq{scroll-snap-type:x mandatory;overscroll-behavior-x:contain}.mq>.xc{scroll-snap-align:start}.mq::-webkit-scrollbar{display:none}.mq>.xc{flex:0 0 160px}@media(min-width:700px){.mq>.xc{flex-basis:200px}}';
const CSS2='.lsw{display:inline-flex;background:rgba(255,255,255,.92);border-radius:99px;padding:3px;box-shadow:0 1px 6px rgba(0,0,0,.2);font-size:12.5px;font-weight:600;font-family:inherit;line-height:1}.lsw button{border:0;background:none;padding:8px 13px;min-height:30px;border-radius:99px;color:#6b625c;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}.lsw button.on{background:#c2552d;color:#fff}';
const st=document.createElement('style');st.textContent=CSS+CSS2;document.head.appendChild(st);
/* infinite auto-scroll row; pauses on touch/drag/wheel, resumes after idle */
function loop(el){/* manual swipe row only: no auto-scroll, no duplicated cards */}
window.MAXGEO={norm,dist,coords,attach,card,loop,esc,fmt,dtxt,SB,lang,en,t,setLang,onLang,sw,pname,nameOf,stn,stFull,typeOf,bathOf,viewOf,tmLabel,tmVal};
})();
