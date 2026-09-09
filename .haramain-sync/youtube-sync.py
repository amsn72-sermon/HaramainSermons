"""Collect public YouTube metadata only. Never download videos or require account cookies."""
import argparse, concurrent.futures, datetime, json, os, re, sys, time
from pathlib import Path
import yt_dlp
CHANNEL='UCB0qibtjzOIemPjQSaoWkGg'
SOURCE='https://www.youtube.com/@Al-haramain-Sermons'
ROOT=Path(__file__).resolve().parent
class Quiet:
 def debug(self,msg): pass
 def warning(self,msg): pass
 def error(self,msg): pass

def extract(url,limit=None):
 opts={'quiet':True,'logger':Quiet(),'extract_flat':'in_playlist','skip_download':True,'socket_timeout':25,'retries':2,'extractor_retries':2}
 if limit:opts['playlistend']=limit
 with yt_dlp.YoutubeDL(opts) as ydl:return ydl.extract_info(url,download=False)

def update(path,cache=None,full=False):
 previous=json.loads(path.read_text()) if path.exists() else {}
 output={**previous,'source':SOURCE+'/playlists','channelId':CHANNEL,'playlists':dict(previous.get('playlists',{})),'videos':dict(previous.get('videos',{}))}
 now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 listing=json.loads((cache.parent/'official-playlists.json').read_text()) if cache else extract(SOURCE+'/playlists')
 if listing.get('channel_id')!=CHANNEL:raise ValueError('Unexpected YouTube channel')
 entries=[p for p in listing.get('entries',[]) if p.get('id') and p.get('url')]
 if not entries:raise ValueError('Empty channel listing; previous archive retained')
 errors=[];checked=0
 # Latest lists every run, plus changed counts and a rotating scan of old lists.
 known=output['playlists']
 chosen={p['id']:p for p in entries[:16]}
 for p in entries:
  old=known.get(p['id'],{})
  if not old or p.get('playlist_count')!=old.get('listedCount'):chosen[p['id']]=p
 for p in sorted(entries,key=lambda p:known.get(p['id'],{}).get('checkedAt',''))[:20]:chosen[p['id']]=p
 if full or cache:chosen={p['id']:p for p in entries}
 chosen=list(chosen.values())[:400 if full or cache else 60]
 def read(p):
  try:
   data=json.loads((cache/(p['id']+'.json')).read_text()) if cache else extract(p['url'])
   if data.get('id')!=p['id']:raise ValueError('Unexpected playlist')
   return p,data,None
  except Exception:return p,None,'تعذر جلب القائمة؛ احتُفظ بآخر بياناتها.'
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for p,data,error in pool.map(read,chosen):
   if error:errors.append(p['id']);continue
   checked+=1
   old=known.get(p['id'],{})
   known[p['id']]={**old,'id':p['id'],'title':data.get('title') or p.get('title',''),'listedCount':p.get('playlist_count'),'checkedAt':now,'count':len(data.get('entries',[]))}
   for entry in data.get('entries',[]):
    vid=entry.get('id','');title=entry.get('title','')
    if not re.fullmatch(r'[\w-]{11}',vid) or not title or title in ['[Private video]','[Deleted video]']:continue
    old=output['videos'].get(vid,{})
    memberships=list(dict.fromkeys([*old.get('playlists',[]),p['id']]))
    output['videos'][vid]={**old,'id':vid,'title':title,'playlists':memberships,'firstSeen':old.get('firstSeen',now),'lastSeen':now}
 # Streams includes scheduled Friday broadcasts before their playlists are updated.
 try:
  streams=json.loads((cache.parent/'official-streams.json').read_text()) if cache else extract(SOURCE+'/streams',80)
  if streams.get('channel_id')!=CHANNEL:raise ValueError('Unexpected stream channel')
  for index,entry in enumerate(streams.get('entries',[])):
   vid=entry.get('id','')
   if not re.fullmatch(r'[\w-]{11}',vid) or not entry.get('title'):continue
   old=output['videos'].get(vid,{})
   output['videos'][vid]={**old,'id':vid,'title':entry['title'],'playlists':old.get('playlists',[]),'liveStatus':entry.get('live_status'),'releaseTimestamp':entry.get('release_timestamp'),'streamOrder':index,'streamsSeenAt':now,'firstSeen':old.get('firstSeen',now),'lastSeen':now}
  output['streamsCheckedAt']=now;output['streamsError']=None
 except Exception:output['streamsError']='تعذر فحص البث المجدول؛ احتُفظ بآخر قائمة سليمة.'
 if not checked and not output.get('streamsCheckedAt'):raise ValueError('No successful YouTube refresh')
 output.update({'version':now,'updatedAt':now,'playlistCount':len(entries),'checkedCount':checked,'failedPlaylists':errors})
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')));tmp.replace(path)
 print(json.dumps({'playlists':len(entries),'checked':checked,'videos':len(output['videos']),'errors':len(errors),'streamsError':output.get('streamsError')}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path);parser.add_argument('--output',type=Path,default=ROOT/'youtube-catalogue.json');parser.add_argument('--full',action='store_true');args=parser.parse_args()
 update(args.output,args.cache,args.full)
