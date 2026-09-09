import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {youtubeFeed} from './server/youtube-catalogue.mjs';
import {classifyChannelVideo} from './server/channel-archive.mjs';
import legacy from './server/channel-seed.mjs';
const catalogue=JSON.parse(readFileSync(new URL('./youtube-catalogue.json',import.meta.url),'utf8'));
// The official YouTube catalogue is the only live content source. No sermons.json or GitHub history requests.
const feed=youtubeFeed(catalogue,legacy.entries.map(classifyChannelVideo));
if(!feed.current.length||!feed.archive.length)throw Error('Empty catalogue; previous display retained');
const file=new URL('../archive/feed.json',import.meta.url);mkdirSync(new URL('../archive/',import.meta.url),{recursive:true});
writeFileSync(file,JSON.stringify(feed));
console.log(JSON.stringify({current:feed.current.length,archive:feed.archive.length,...feed.catalogueInfo}));
