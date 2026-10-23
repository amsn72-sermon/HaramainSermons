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

def extract(url,limit=None):
 opts={'quiet':True,'logger':Quiet(),'extract_flat':'in_playlist','skip_download':True,'socket_timeout':25,'retries':2,'extractor_retries':2}
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
 output.update({'version':now,'updatedAt':now,'playlistCount':total_lists,'checkedCount':checked,'failedPlaylists':errors})
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')));tmp.replace(path)
 print(json.dumps({'channels':len(chans),'playlists':total_lists,'checked':checked,'videos':len(output['videos']),'errors':len(errors),'streamsError':output.get('streamsError')}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path);parser.add_argument('--output',type=Path,default=ROOT/'youtube-catalogue.json');parser.add_argument('--full',action='store_true');args=parser.parse_args()
 update(args.output,args.cache,args.full)
