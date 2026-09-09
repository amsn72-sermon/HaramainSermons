import legacy from './channel-seed.mjs';
import {dateFromTitle} from './video-date.mjs';
const normalize=v=>String(v||'').normalize('NFKC').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLowerCase();
const aliases={ar:['العربية','arabic'],ur:['اردو','urdu'],fa:['فارسی','persian'],ms:['melayu','malay'],id:['indonesia'],ru:['русский','russian'],tr:['türkçe','turkish'],bn:['বাংলা','bengali'],es:['español','spanish'],pt:['português','portuguese'],ps:['البشتو','پښتو'],km:['الكمبودية','ខ្មែរ'],jula:['جولا','jola'],ku:['كرمانجي','الكردية'],ar:['العربية','عربي','arabic']};
export function languageFor(value){const text=normalize(value);return legacy.languages.find(l=>[l.language,l.englishName,...(aliases[l.code]||[])].some(name=>text.includes(normalize(name))));}
function venueFor(value){const t=normalize(value);if(/عرف|araf|arefat|carafo/.test(t))return 'arafah';if(/المسجد النبوي|مسجدالنبي|مسجد نبوي|مسجد نبوی|المدين[هة]|مدين[هة]|madina|medina|prophet|profeta|nabawi|nabav|nebevi|nebevi|пророка|masallacin annabi|মসজিদে নববী|مسجد نبوی/.test(t))return 'madinah';if(/المسجد الحرام|مسجدالحرام|مسجد الحرام|مك[هة]|makkah|mecca|meca|mecque|haram|харама|харам|sagrada|masallaci mai alfarma|হারাম|禁寺/.test(t))return 'makkah';return null;}
function kindFor(value){const t=normalize(value);return /عرف|araf|arefat|carafo/.test(t)?'arafah':/رمضان|ramadan|ramazan/.test(t)?'ramadan':/عيد|eid|adha|fitr|宰牲节/.test(t)?'eid':/جمع[هة]|friday|viernes|sexta-feira|jumaat|jumat|vendredi|cuma|пятнич|主麻/.test(t)?'friday':/درس|دروس|علمي|مجالس|محاضر|lesson|lecture/.test(t)?'lesson':null;}
export function classifyOfficialVideo(video,catalogue){
 const lists=(video.playlists||[]).map(id=>catalogue.playlists?.[id]).filter(Boolean);
 const specific=lists.find(p=>kindFor(p.title));
 const title=String(video.title||'');const kind=kindFor(specific?.title)||kindFor(title)||'other';
 const venue=kind==='arafah'?'arafah':kind==='ramadan'?venueFor(specific?.title)||'unclassified':venueFor(title)||venueFor(specific?.title)||'unclassified';
 const tail=title.includes('(')?title.slice(title.lastIndexOf('(')):title;
 const lang=languageFor(tail)||lists.filter(p=>!kindFor(p.title)).map(p=>languageFor(p.title)).find(Boolean)||(/^خطبة|^برنامج المجالس/.test(title)?legacy.languages[0]:null)||{code:'unknown',language:'لغة غير محددة',englishName:''};
 let date=dateFromTitle(title),dateSource='video';
 const listDate=dateFromTitle(specific?.title||'');
 if((!date.year||date.label.startsWith('عام '))&&listDate.year){date=listDate;dateSource='playlist';}
 if(!date.year&&video.releaseTimestamp){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Riyadh'}).formatToParts(new Date(video.releaseTimestamp*1000)).map(p=>[p.type,p.value]));date={label:parts.day+'-'+parts.month+'-'+parts.year+'هـ (موعد البث)',year:parts.year,calendar:'hijri'};dateSource='scheduled';}
 const dateParts=date.label.match(/(\d{2})-(\d{2})-(\d{4})/);
 const order=dateParts?[dateParts[3],dateParts[2],dateParts[1]].join('-'):date.year?date.year+'-00-00':'';
 const groupTitle=specific?.title||title;
 return {id:'youtube:'+video.id,videoId:video.id,title,originalTitle:title,groupTitle,playlistId:specific?.id||null,venue,kind,date:null,dateLabel:date.label,dateSource,year:date.year,calendar:date.calendar,sourceTime:order,liveStatus:video.liveStatus||null,source:'youtube',needsClassification:venue==='unclassified'||lang.code==='unknown'||kind==='other',translations:[{...lang,videoId:video.id,url:'https://www.youtube.com/watch?v='+video.id,liveStatus:video.liveStatus||null}]};
}
export function groupVideos(records){const byVideo=new Map();for(const r of records)for(const t of r.translations||[])if(t.videoId&&!byVideo.has(t.videoId))byVideo.set(t.videoId,{r,t});
 const groups=new Map();for(const {r,t} of byVideo.values()){
  const dated=!!r.year;const key=r.venue==='unclassified'?(r.playlistId?'playlist:'+r.playlistId:r.id):r.kind==='ramadan'&&r.playlistId?'playlist:'+r.playlistId:dated?[r.venue,r.kind,r.calendar,r.dateLabel].join('|'):r.id;
  let g=groups.get(key);if(!g){g={...r,id:key,title:r.groupTitle||r.title,translations:[]};groups.set(key,g);}
  g.translations.push({...t,code:t.code+':'+t.videoId});
  if(t.code==='ar')g.title=r.originalTitle||r.title;
  if(t.liveStatus==='is_upcoming'||t.liveStatus==='is_live')g.liveStatus=t.liveStatus;
 }
 return [...groups.values()].sort((a,b)=>(b.sourceTime||'').localeCompare(a.sourceTime||''));
}
export function youtubeFeed(catalogue,additional=[]){
 // One canonical record for each YouTube video ID, irrespective of URL shape or list membership.
 const official=Object.values(catalogue.videos||{}).map(v=>classifyOfficialVideo(v,catalogue));
 const groups=groupVideos([...official,...additional]);
 const current=[];for(const venue of ['makkah','madinah','arafah']){const item=groups.find(g=>g.venue===venue&&g.kind===(venue==='arafah'?'arafah':'friday')&&g.year);if(item)current.push(item);}
 const active=new Set(current.map(g=>g.id));const archive=groups.filter(g=>!active.has(g.id));
 const ids=[...current,...archive].flatMap(g=>g.translations.map(t=>t.videoId));
 if(ids.length!==new Set(ids).size)throw Error('Duplicate YouTube IDs');
 return {schemaVersion:1,connection:groups.length?'connected':'awaiting_source',sourceUrl:catalogue.source,lastSuccessfulSync:catalogue.updatedAt,syncError:catalogue.streamsError||null,historyPending:0,historyIssues:0,storage:'persistent',pollSeconds:60,syncIntervalMinutes:15,current,archive,catalogueInfo:{videoCount:ids.length,playlistCount:catalogue.playlistCount,groups:groups.length,unclassified:official.filter(r=>r.needsClassification).length,failedPlaylists:catalogue.failedPlaylists?.length||0,streamsCheckedAt:catalogue.streamsCheckedAt,source:catalogue.source}};
}
