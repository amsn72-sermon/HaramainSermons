import seed from './channel-seed.mjs';
import {dateFromTitle} from './video-date.mjs';
const normalize=value=>value.normalize('NFKC').replace(/[أإآ]/g,'ا').replace(/[ى]/g,'ي').toLowerCase();
export function classifyChannelVideo(video){
  const title=String(video.title||''); const clean=normalize(title);
  let venue=seed.knownVenues[video.id]||'unclassified';
  const arafah=/araf|arefat|carafo|عرف|አረፋ/i.test(title);
  if(arafah)venue='arafah';
  else if(/المسجد النبوي|المسجد النبوى|مدينه|مدينة|medinah|medina|do profeta/i.test(clean))venue='madinah';
  else if(/المسجد الحرام|مكه|مكة|mecca|meca|makkah|mesquita sagrada|禁寺/i.test(clean))venue='makkah';
  // 圣寺 by itself does not unambiguously identify a mosque. Keep unresolved
  // titles in a visible category unless the owner's GitHub data identifies it.
  let kind=arafah?'arafah':/عيد|宰牲节|eid|adha|fitr/i.test(title)?'eid':/درس|دروس|lesson|lecture/i.test(title)?'lesson':/جمعه|جمعة|主麻|sexta-feira|viernes|friday/i.test(clean)?'friday':'other';
  const tail=clean.slice(clean.lastIndexOf('('));
  let language=seed.languages.find(l=>tail.includes(normalize(l.language))||tail.includes(normalize(l.englishName)));
  if(!language&&/中文|الصينيه|الصينية/.test(clean))language={code:'zh',language:'الصينية',englishName:'Chinese'};
  if(!language&&/^خطبة الجمعة/.test(title))language={code:'ar',language:'العربية',englishName:'Arabic'};
  language=language||{code:'unknown',language:'لغة غير محددة',englishName:''};
  let date=dateFromTitle(title);
  if(!date.year){const y=title.match(/\b(14\d{2})\s*(?:H\b|هـ)/i);if(y)date={label:'عام '+y[1]+'هـ',year:y[1],calendar:'hijri'};}
  return {id:'channel:'+video.id,venue,kind,title,originalTitle:title,date:null,dateLabel:date.label,year:date.year,calendar:date.calendar,sourceTime:video.published||'',source:'youtube-channel',needsClassification:venue==='unclassified'||language.code==='unknown'||kind==='other',translations:[{...language,videoId:video.id,url:'https://www.youtube.com/watch?v='+video.id}]};
}
const decode=value=>value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x])).replace(/&#(x[\da-f]+|\d+);/gi,(_,x)=>{const code=x[0].toLowerCase()==='x'?parseInt(x.slice(1),16):Number(x);return code<=0x10ffff?String.fromCodePoint(code):'';});
export function parseChannelFeed(xml){if(!xml.includes(seed.channelId))throw Error('unexpected_channel');return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([,entry])=>({id:entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1],title:decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]||''),published:entry.match(/<published>([^<]+)<\/published>/)?.[1]||''})).filter(v=>v.id&&v.title);}
async function insert(db,entries,ignore=false){const sql=ignore?'INSERT OR IGNORE INTO youtube_channel_archive(video_id,title,payload,first_seen) VALUES(?,?,?,?)':'INSERT INTO youtube_channel_archive(video_id,title,payload,first_seen) VALUES(?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,payload=excluded.payload';for(let start=0;start<entries.length;start+=40)await db.batch(entries.slice(start,start+40).map(v=>db.prepare(sql).bind(v.id,v.title,JSON.stringify(classifyChannelVideo(v)),new Date().toISOString())));}
export async function syncChannel(db,fetcher=fetch){
  await db.prepare('INSERT OR IGNORE INTO youtube_channel_sync(id) VALUES(1)').run();
  let state=await db.prepare('SELECT * FROM youtube_channel_sync WHERE id=1').first();
  if(state.seed!==seed.version){await insert(db,seed.entries,true);await db.prepare('UPDATE youtube_channel_sync SET seed=? WHERE id=1').bind(seed.version).run();}
  if(Date.now()-state.checked<120000)return;
  const claimed=await db.prepare('UPDATE youtube_channel_sync SET checked=? WHERE id=1 AND checked=?').bind(Date.now(),state.checked).run();if(!claimed.meta.changes)return;
  try{const response=await fetcher('https://www.youtube.com/feeds/videos.xml?channel_id='+seed.channelId,{redirect:'manual',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('channel_unavailable');const xml=await response.text();if(xml.length>1000000)throw Error('oversized_feed');const entries=parseChannelFeed(xml);if(!entries.length)throw Error('empty_feed');let matched=0;for(const video of entries){if(await db.prepare('SELECT video_id FROM youtube_channel_archive WHERE video_id=?').bind(video.id).first())matched++;}
    await insert(db,entries);await db.prepare('UPDATE youtube_channel_sync SET successful=?,error=NULL,gap=CASE WHEN ?=0 THEN 1 ELSE gap END WHERE id=1').bind(new Date().toISOString(),matched).run();
  }catch{await db.prepare('UPDATE youtube_channel_sync SET error=? WHERE id=1').bind('تعذر تحديث القناة؛ تظهر آخر قائمة محفوظة.').run();}
}
export async function readChannel(db){const state=await db.prepare('SELECT * FROM youtube_channel_sync WHERE id=1').first();const {results}=await db.prepare('SELECT payload FROM youtube_channel_archive').all();return {items:results.map(r=>JSON.parse(r.payload)),source:seed.source,importedCount:seed.entries.length,lastSync:state?.successful||null,error:state?.error||null,needsFullSync:!!state?.gap};}
