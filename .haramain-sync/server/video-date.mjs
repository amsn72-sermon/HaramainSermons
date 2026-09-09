export function dateFromTitle(title) {
  const normal=title.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
  const iso=normal.match(/\b(1[34]\d{2}|20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\b/);
  if(iso){const[,y,m,d]=iso;if(+d>=1&&+d<=31&&+m>=1&&+m<=12)return {label:`${d.padStart(2,'0')}-${m.padStart(2,'0')}-${y}${+y<1700?'هـ':'م'}`,year:y,calendar:+y<1700?'hijri':'gregorian'};}
  const numeric=normal.match(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(1[34]\d{2}|20\d{2})\s*(هـ?|م)?/);
  if(numeric){const[,d,m,y]=numeric;if(+d>=1&&+d<=31&&+m>=1&&+m<=12)return {label:`${d.padStart(2,'0')}-${m.padStart(2,'0')}-${y}${+y<1700?'هـ':'م'}`,year:y,calendar:+y<1700?'hijri':'gregorian'};}
  const year=normal.match(/(?:لعام|عام|سنة)\s*(1[34]\d{2}|20\d{2})\s*(هـ?|م)?/);
  if(year)return {label:`عام ${year[1]}${+year[1]<1700?'هـ':'م'}`,year:year[1],calendar:+year[1]<1700?'hijri':'gregorian'};
  return {label:'التاريخ غير محدد بوضوح في عنوان الفيديو',year:'',calendar:null};
}

