import catalog from '../public/checked-apps.json' with {type:'json'};
export const CHECKED_APPS=catalog.items;
export const CHECKED_AT=catalog.checkedAt;
export function checkedRecord(item){const record=CHECKED_APPS.find(record=>record.id===item.id && record.commit && record.commit===item.commit);return record?.package&&item.selectedEntry&&item.selectedEntry!==record.package.recommendedEntry?null:record||null;}
export function checkedHomepage(repository){return CHECKED_APPS.find(record=>record.repository===repository)?.homepage || null;}
export function websiteCheck(url){return catalog.websites.find(record=>record.url===url) || null;}
export function checkedPackageDetail(item){
  const record=checkedRecord(item);
  if(!record?.package)return null;
  return {...record,...record.package,inspected:true,installable:true,branch:'Checked version',installReason:'These exact source files passed package analysis. Downloaded files are checked against their SHA-256 fingerprints and analyzed again before installation.',releases:[],notes:[],licenseCaveat:'Repository license observed. This is not an audit of all dependency licenses.'};
}
