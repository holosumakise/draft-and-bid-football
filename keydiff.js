const fs=require('fs'),vm=require('vm');
const c=vm.createContext({console,Math,JSON,Object,Array,String,Number,Set,Map,isFinite,isNaN,Error,
  document:{getElementById:()=>null,addEventListener(){}},window:{addEventListener(){}}});
for (const f of ['config.js']) vm.runInContext(fs.readFileSync(f,'utf8'),c,{filename:f});
const S=vm.runInContext('SPECIALITIES',c), D=vm.runInContext('SPECIALITY_DEFAULTS',c);
const allowed=new Set(Object.keys(D)); allowed.add('name'); allowed.add('group'); allowed.add('positions'); allowed.add('fit');
const bad=[];
Object.entries(S).forEach(([k,v])=>Object.keys(v).forEach(f=>{ if(!allowed.has(f)) bad.push(k+'.'+f+' = '+JSON.stringify(v[f])); }));
console.log('SPECIALITIES entries:',Object.keys(S).length);
console.log('fields that specialityEffects silently drops:', bad.length);
bad.forEach(b=>console.log('  '+b));
// and: any DEFAULTS field that nothing reads?
const src=fs.readFileSync('config.js','utf8')+fs.readFileSync('match-engine.js','utf8')+fs.readFileSync('season.js','utf8')+fs.readFileSync('ui.js','utf8')+fs.readFileSync('cards.js','utf8');
const unused=Object.keys(D).filter(f=>f!=='workload' && !new RegExp('\b'+f+'\b','').test(src.replace(/const SPECIALITY_DEFAULTS[\s\S]*?\}\);/,'')));
console.log('DEFAULTS fields never referenced outside the defaults block:', unused.length?unused.join(', '):'none');
