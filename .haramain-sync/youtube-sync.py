"""Collect public YouTube metadata only. Never download videos or require account cookies."""
import argparse, concurrent.futures, datetime, json, os, re, sys, time, urllib.request
from pathlib import Path
import yt_dlp
# البثُّ يقع على ثلاث قنواتٍ لقيود يوتيوب في عدد البثوث المتزامنة، ثم
#   تُجمَع قوائمُها في الرئيسية يدويًّا. فصارت المزامنةُ تقرأ الثلاثَ
#   مباشرةً، فلا يتعلّق البثُّ بذاكرة أحد (ملاحظة ٤٦٧).
#   والترتيبُ ترتيبُ الترجيح عند التعارض: الرئيسيةُ أولًا.
CHANNELS=[
 {'id':'UCB0qibtjzOIemPjQSaoWkGg','source':'https://www.youtube.com/@Al-haramain-Sermons'},
 {'id':'UC5rhniBqrWnRj18iD4EO9uQ','source':'https://www.youtube.com/channel/UC5rhniBqrWnRj18iD4EO9uQ'},
 {'id':'UCi2WjWXhNrzuDJ53CbpebtA','source':'https://www.youtube.com/channel/UCi2WjWXhNrzuDJ53CbpebtA'},
]
# وقائمةُ القنوات تُدار من المنصة كذلك: تُقرأ قبل كلِّ دورة، فإن تعذّرت
#   بقيت المحفورةُ أعلاه عاملةً فلا تتوقّف المزامنة (ملاحظة ٤٦٧)
CHANNELS_API=os.environ.get('HS_CHANNELS_API','https://api.haramainsermons.com/rest/v1/rpc/sync_channels')
# مفتاحُ القراءة العلنيُّ نفسُه الذي في `config.js` — لا يفتح إلا ما فُتح
#   للزائر، وقائمةُ القنوات منه
CHANNELS_KEY=os.environ.get('HS_ANON_KEY','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkwMjU2MDU0LCJleHAiOjE5NDc5MzYwNTR9.WkpNMkflmGpbaRCK5Gc1ZCge8w4qhFsDw7i-ROPH5x0')
CHANNEL=CHANNELS[0]['id']
SOURCE=CHANNELS[0]['source']
ROOT=Path(__file__).resolve().parent
class Quiet:
 def debug(self,msg): pass
 def warning(self,msg): pass
 def error(self,msg): pass

def channels():
 """قائمةُ القنوات: من المنصة إن أجابت، وإلا فالمحفورةُ في الملف."""
 if not CHANNELS_KEY:return list(CHANNELS)
 try:
  req=urllib.request.Request(CHANNELS_API,data=b'{}',headers={
   'Content-Type':'application/json','apikey':CHANNELS_KEY,
   'Authorization':'Bearer '+CHANNELS_KEY})
  with urllib.request.urlopen(req,timeout=20) as r:rows=json.loads(r.read().decode())
  out=[]
  for row in rows if isinstance(rows,list) else []:
   cid=str(row.get('channel_id') or '').strip()
   if not re.fullmatch(r'UC[\w-]{22}',cid):continue
   out.append({'id':cid,'source':(str(row.get('source') or '').strip()
     or 'https://www.youtube.com/channel/'+cid)})
  return out or list(CHANNELS)
 except Exception:return list(CHANNELS)

# ـــ لغةُ المقطع ونصُّه المصاحب (ملاحظتا ٤٧١ و٤٧٢)
#   عنوانُ المقطع قد لا يحمل اسمَ لغته، ويوتيوب يعرف لغةَ صوته.
#   والنصُّ المصاحبُ لا يُولَّد أثناء البثّ، وإنما يُخزَّن بعد انتهائه،
#   فيُجلَب في دورةٍ تالية. ونأخذ توقيتَ كلِّ كلمةٍ لا توقيتَ السطر،
#   لتُضاءَ الكلمةُ مع نطقها.
CAPTIONS=ROOT.parent/'archive'/'captions'
ENRICH_MAX=int(os.environ.get('HS_ENRICH_MAX','24'))   # حدٌّ لزمن الدورة
ENRICH_DAYS=int(os.environ.get('HS_ENRICH_DAYS','21')) # المقاطع الحديثة وحدَها
CAP_TRIES=3                                            # ثم يُترَك المقطع
# الجملةُ تنتهي بعلامة وقف، أو تطول فتُقطَع عند فاصلةٍ، أو يسكت القائل
STOP='.؟?!۔।。'
SOFT='،,;؛:'
CUE_CHARS=72
CUE_GAP=2.0

def cues_from_json3(raw):
 """يحوّل نصَّ يوتيوب إلى جملٍ، في كلِّ جملةٍ كلماتُها بتوقيتها."""
 data=json.loads(raw)
 words=[]
 for ev in data.get('events') or []:
  base=ev.get('tStartMs')
  if base is None:continue
  for seg in ev.get('segs') or []:
   text=seg.get('utf8') or ''
   if not text.strip():continue
   words.append([round((base+(seg.get('tOffsetMs') or 0))/1000,2),text.strip()])
 words.sort(key=lambda w:w[0])
 cues=[];cur=[]
 def flush():
  if cur:cues.append({'t':cur[0][0],'e':round(cur[-1][0]+0.9,2),'w':[list(w) for w in cur]})
  cur.clear()
 for i,w in enumerate(words):
  if cur and (w[0]-cur[-1][0])>CUE_GAP:flush()
  cur.append(w)
  text=' '.join(x[1] for x in cur)
  last=cur[-1][1][-1:]
  nxt=words[i+1][0] if i+1<len(words) else None
  if last in STOP:flush()
  elif len(text)>=CUE_CHARS and (last in SOFT or last in STOP):flush()
  elif len(text)>=CUE_CHARS*1.5:flush()
  elif nxt is not None and (nxt-w[0])>CUE_GAP:flush()
 flush()
 return cues

def caption_track(info):
 """المسارُ الموافقُ للغة الصوت: اليدويُّ أوّلًا ثم الآليّ."""
 lang=(info.get('language') or '').split('-')[0]
 for store in (info.get('subtitles') or {},info.get('automatic_captions') or {}):
  keys=[k for k in store if k.split('-')[0]==lang] if lang else []
  keys=keys or ([k for k in store if '-' not in k] if not lang else [])
  for key in keys:
   for fmt in store[key]:
    if fmt.get('ext')=='json3' and fmt.get('url'):return key,fmt['url']
 return None,None

def enrich(output,now):
 """يسأل يوتيوب عن المقاطع الحديثة: لغةُ صوتها ونصُّها المصاحب."""
 cutoff=(datetime.datetime.now(datetime.timezone.utc)
   -datetime.timedelta(days=ENRICH_DAYS)).isoformat()
 pool=[]
 for vid,v in output['videos'].items():
  if v.get('lastSeen')!=now:continue
  if v.get('liveStatus') in ('is_upcoming','is_live'):continue
  if (v.get('firstSeen') or '')<cutoff and (v.get('streamsSeenAt') or '')<cutoff:continue
  if v.get('capState')=='ok' and v.get('audioLang'):continue
  if (v.get('capTries') or 0)>=CAP_TRIES:continue
  pool.append((v.get('firstSeen') or '',vid))
 pool.sort(reverse=True)
 done=0;got=0
 for _,vid in pool[:ENRICH_MAX]:
  v=output['videos'][vid]
  v['capTries']=(v.get('capTries') or 0)+1
  try:
   info=extract('https://www.youtube.com/watch?v='+vid,flat=False)
  except Exception:
   v['capState']='error';continue
  done+=1
  if info.get('language'):v['audioLang']=info['language']
  key,url=caption_track(info)
  if not url:
   v['capState']='none';continue
  try:
   with urllib.request.urlopen(url,timeout=30) as r:raw=r.read().decode('utf-8','replace')
   cues=cues_from_json3(raw)
  except Exception:
   v['capState']='error';continue
  if not cues:
   v['capState']='none';continue
  CAPTIONS.mkdir(parents=True,exist_ok=True)
  (CAPTIONS/(vid+'.json')).write_text(json.dumps(
    {'v':1,'lang':key,'videoId':vid,'cues':cues},ensure_ascii=False,separators=(',',':')))
  v['capState']='ok';v['captionsAt']=now;got+=1
 return {'asked':done,'captions':got,'pool':len(pool)}

def extract(url,limit=None,flat=True):
 opts={'quiet':True,'logger':Quiet(),'skip_download':True,'socket_timeout':25,'retries':2,'extractor_retries':2}
 if flat:opts['extract_flat']='in_playlist'
 else:opts.update({'writesubtitles':False,'writeautomaticsub':False,'noplaylist':True})
 if limit:opts['playlistend']=limit
 with yt_dlp.YoutubeDL(opts) as ydl:return ydl.extract_info(url,download=False)

def update(path,cache=None,full=False):
 previous=json.loads(path.read_text()) if path.exists() else {}
 chans=channels()
 output={**previous,'source':chans[0]['source']+'/playlists','channelId':chans[0]['id'],
   'channels':[c['id'] for c in chans],
   'playlists':dict(previous.get('playlists',{})),'videos':dict(previous.get('videos',{}))}
 now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 errors=[];checked=0;total_lists=0;ok_any=False
 known=output['playlists']

 for rank,chan in enumerate(chans):
  # الملفُّ المخبّأ للاختبار يخصُّ القناةَ الأولى وحدَها
  cache_dir=cache if (cache and rank==0) else None
  try:
   listing=json.loads((cache_dir.parent/'official-playlists.json').read_text()) if cache_dir else extract(chan['source']+'/playlists')
  except Exception:
   errors.append('channel:'+chan['id']);continue
  if listing.get('channel_id')!=chan['id']:
   errors.append('channel:'+chan['id']);continue
  entries=[p for p in listing.get('entries',[]) if p.get('id') and p.get('url')]
  if not entries:
   errors.append('channel:'+chan['id']);continue
  total_lists+=len(entries)
  # Latest lists every run, plus changed counts and a rotating scan of old lists.
  chosen={p['id']:p for p in entries[:16]}
  for p in entries:
   old=known.get(p['id'],{})
   if not old or p.get('playlist_count')!=old.get('listedCount'):chosen[p['id']]=p
  for p in sorted(entries,key=lambda p:known.get(p['id'],{}).get('checkedAt',''))[:20]:chosen[p['id']]=p
  if full or cache_dir:chosen={p['id']:p for p in entries}
  chosen=list(chosen.values())[:400 if full or cache_dir else 60]
  def read(p,cd=cache_dir):
   try:
    data=json.loads((cd/(p['id']+'.json')).read_text()) if cd else extract(p['url'])
    if data.get('id')!=p['id']:raise ValueError('Unexpected playlist')
    return p,data,None
   except Exception:return p,None,'تعذر جلب القائمة؛ احتُفظ بآخر بياناتها.'
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   for p,data,error in pool.map(read,chosen):
    if error:errors.append(p['id']);continue
    checked+=1;ok_any=True
    old=known.get(p['id'],{})
    known[p['id']]={**old,'id':p['id'],'title':data.get('title') or p.get('title',''),'listedCount':p.get('playlist_count'),'checkedAt':now,'count':len(data.get('entries',[])),'channelId':chan['id'],'channelRank':rank}
    for entry in data.get('entries',[]):
     vid=entry.get('id','');title=entry.get('title','')
     if not re.fullmatch(r'[\w-]{11}',vid) or not title or title in ['[Private video]','[Deleted video]']:continue
     old=output['videos'].get(vid,{})
     memberships=list(dict.fromkeys([*old.get('playlists',[]),p['id']]))
     # صاحبُ المقطع هو قناتُه لا قناةَ القائمة التي ضمَّته، ورتبتُه
     #   أعلى الرتب التي وُجد فيها (ملاحظة ٤٦٧)
     rank_old=old.get('channelRank')
     output['videos'][vid]={**old,'id':vid,'title':title,'playlists':memberships,
       'duration':entry.get('duration') or old.get('duration'),
       'ownerChannel':entry.get('channel_id') or old.get('ownerChannel'),
       'channelRank':rank if rank_old is None else min(rank_old,rank),
       'firstSeen':old.get('firstSeen',now),'lastSeen':now}

  # Streams includes scheduled Friday broadcasts before their playlists are updated.
  try:
   streams=json.loads((cache_dir.parent/'official-streams.json').read_text()) if cache_dir else extract(chan['source']+'/streams',80)
   if streams.get('channel_id')!=chan['id']:raise ValueError('Unexpected stream channel')
   for index,entry in enumerate(streams.get('entries',[])):
    vid=entry.get('id','')
    if not re.fullmatch(r'[\w-]{11}',vid) or not entry.get('title'):continue
    old=output['videos'].get(vid,{})
    rank_old=old.get('channelRank')
    output['videos'][vid]={**old,'id':vid,'title':entry['title'],'playlists':old.get('playlists',[]),'liveStatus':entry.get('live_status'),'releaseTimestamp':entry.get('release_timestamp'),'streamOrder':index,'streamsSeenAt':now,
      'duration':entry.get('duration') or old.get('duration'),
      'ownerChannel':entry.get('channel_id') or old.get('ownerChannel') or chan['id'],
      'channelRank':rank if rank_old is None else min(rank_old,rank),
      'firstSeen':old.get('firstSeen',now),'lastSeen':now}
   output['streamsCheckedAt']=now;output['streamsError']=None;ok_any=True
  except Exception:output['streamsError']='تعذر فحص البث المجدول؛ احتُفظ بآخر قائمة سليمة.'

 if not ok_any and not output.get('streamsCheckedAt'):raise ValueError('No successful YouTube refresh')
 if not output['videos']:raise ValueError('Empty channel listing; previous archive retained')
 # إثراءُ المقاطع الحديثة لا يُفشِل الدورةَ إن تعثَّر، فالأرشيفُ أهمُّ منه
 try:extra=enrich(output,now) if not cache else {'asked':0,'captions':0,'pool':0}
 except Exception:extra={'asked':0,'captions':0,'pool':0,'error':True}
 output.update({'version':now,'updatedAt':now,'playlistCount':total_lists,'checkedCount':checked,'failedPlaylists':errors})
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')));tmp.replace(path)
 print(json.dumps({'channels':len(chans),'playlists':total_lists,'checked':checked,'videos':len(output['videos']),'errors':len(errors),'streamsError':output.get('streamsError'),'enrich':extra}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path);parser.add_argument('--output',type=Path,default=ROOT/'youtube-catalogue.json');parser.add_argument('--full',action='store_true');args=parser.parse_args()
 update(args.output,args.cache,args.full)
