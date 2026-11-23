import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {blank,getDraft,saveDraft} from '../../src/drafts.mjs';
import {delta,maskPII} from '../../src/privacy.mjs';
import {activeInterval,boundedBatch,editKind,projectEvents,reconciles,timeline} from './history.mjs';

const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE drafts (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL)');
const env={DB:{prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args),run:async()=>({meta:{changes:db.prepare(sql).run(...args).changes}})};}};}}};
const user={id:'qa-writing'};
const checks=[];
function same(label,value,expected){assert.deepEqual(value,expected,label);checks.push(label);}
function edit(text,type,activeMs){return {type,text,activeMs};}
const revision=0;
const raw='Start with a question. ابدأ بسؤال قصير.';
const paste=raw+' This paragraph was pasted into the editor to record an explicit bulk paste event.';
const events=[
 edit(raw,'type',420),edit(paste,'paste',700),
 edit(paste.replace('question','claim'),'replace',1200),
 edit('Contact: sample@example.org','replace',800),edit('','delete',250)
];
const request=(r,events)=>new Request('https://example.test/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:r,events})});
try{
 same('typing and interval classification',[editKind('insertText'),editKind('insertFromPaste'),editKind('deleteContentBackward'),editKind('insertReplacementText')],['type','paste','delete','replace']);
 same('focused short gaps count; initial and idle gaps excluded',[activeInterval(20,720),activeInterval(null,720),activeInterval(20,16020)],[700,0,0]);
 const initial=await getDraft(env,user);
 same('opening a new workspace',initial,blank());
 const ack=await saveDraft(env,user,request(revision,events));same('JSON save status',ack.status,200);
 const persisted=await getDraft(env,user);
 same('active time persisted',persisted.activeMs,3370);
 same('one large paste and five deltas persisted',[persisted.events.filter(e=>e.bulk).length,persisted.events.length],[1,5]);
 const look=timeline(persisted.events);
 same('scrubbing reconstructs English and Arabic',[look(0),look(1),look(2),look(5)],['',raw,paste,'']);
 same('PII removed in preview and stored history',!JSON.stringify(persisted).includes('sample@example.org')&&!look(4).includes('@'),true);
 same('response-loss retry recognizes committed edits',reconciles(initial,persisted,events),true);
 same('divergence in another tab is preserved',reconciles(initial,persisted,[edit('other edit','type',0)]),false);
 let code=0;try{await saveDraft(env,user,request(0,[edit('outdated','replace',0)]));}catch(e){code=e.status;}
 same('stale client revision rejected',code,409);
 const series=Array.from({length:113},(_,i)=>edit('أي نص '+String(i),'type',8));
 const projected=projectEvents('',series);const indexed=timeline(projected.changes);
 same('checkpoint playback across boundaries',[indexed(47),indexed(48),indexed(49),indexed(96),indexed(113)],[47,48,49,96,113].map(x=>series[x-1].text));
 same('count-bounded transport',boundedBatch(series).length,50);
 const large=Array.from({length:22},()=>edit('أ'.repeat(60000),'type',0));const body=boundedBatch(large);
 same('UTF-8 byte cap applied to actual serialized Arabic request',body.length<large.length && Buffer.byteLength(JSON.stringify({revision,events:body}),'utf8')<900000,true);
 const owner={id:'progressive'};
 const prefix='Research contact: ',suffix=' carries a short note.';
 const rawEarlier=[prefix+'aval'+suffix,prefix+'aval@example'+suffix,prefix+'aval@example.c'+suffix];
 let rev=0;
 for(const snapshot of rawEarlier){await saveDraft(env,owner,request(rev++,[edit(snapshot,'type',25)]));}
 const beforeEmail=await getDraft(env,owner);
 const marker=crypto.randomUUID();
 const signedSave=new Request('https://example.test/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:rev,editId:marker,events:[edit(prefix+'aval@example.co'+suffix,'type',30)]})});
 const changed=await (await saveDraft(env,owner,signedSave)).json();rev++;
 same('cross-save PII match instructs browser to fetch rewritten history',changed.historyRewritten,true);
 const afterEmail=await getDraft(env,owner);
 const replay=timeline(afterEmail.events);
 same('all older email fragments scrubbed from persisted SQLite payload',!/aval|example|@/.test(db.prepare('SELECT state FROM drafts WHERE owner=?').get(owner.id).state),true);
 same('unrelated surrounding text and revision positions survive retroactive masking',[replay(1),replay(2),replay(3)],[4,12,14].map(n=>prefix+'█'.repeat(n)+suffix));
 same('response-loss reconciliation works after canonical history rewrite',reconciles(beforeEmail,afterEmail,[edit(prefix+'aval@example.co'+suffix,'type',30)],marker),true);
 const partial=await (await saveDraft(env,owner,request(rev++,[edit(prefix+'aval@example.c'+suffix,'delete',15)]))).json();
 same('deleting below recognition threshold keeps known private cells masked',[(await getDraft(env,owner)).text,partial.historyRewritten],[prefix+'█'.repeat(14)+suffix,true]);
 const named={id:'labelled-student'};
 const nameFrames=['أبحاث في التعليم','أبحاث في التعليم\nاسم الط','أبحاث في التعليم\nاسم الطالب: زينب','أبحاث في التعليم\nاسم الطالب: زينب علي'];
 await saveDraft(env,named,request(0,nameFrames.map(text=>edit(text,'type',30))));
 const namedState=await getDraft(env,named),namedReplay=timeline(namedState.events);
 same('same-batch Arabic name and earlier label fragments scrubbed',!JSON.stringify(namedState).includes('زينب')&&!namedReplay(2).includes('اسم')&&namedReplay(1)===nameFrames[0],true);
 const oldFrames=[...rawEarlier,prefix+'aval@example.co'+suffix],legacy={revision:4,text:'',activeMs:0,events:[]};
 for(const rawText of oldFrames){const text=maskPII(rawText);legacy.events.push({...delta(legacy.text,text),at:1,kind:'type',activeMs:1,bulk:false});legacy.text=text;legacy.activeMs++;}
 db.prepare('INSERT INTO drafts VALUES (?,?,?,?)').run('pre-upgrade',legacy.revision,JSON.stringify(legacy),Math.floor(Date.now()/1000)+1200);
 const fixed=await getDraft(env,{id:'pre-upgrade'});
 same('legacy history converted and persisted with one optimistic revision increment',[fixed.revision,fixed.privacyVersion,fixed.events.length,db.prepare('SELECT revision FROM drafts WHERE owner=?').get('pre-upgrade').revision],[5,2,4,5]);
 same('legacy partial values absent from every reconstructed historical frame',fixed.events.every((_,i)=>!/aval|example|@/.test(timeline(fixed.events)(i+1))),true);
 same('subsequent reads of legacy record do not rewrite again',(await getDraft(env,{id:'pre-upgrade'})).revision,5);
 const crowded={id:'qa-large-private-history'};
 const contactLines=('u@example.org '.repeat(5000)).trim();
 for(let i=0;i<11;i++)await saveDraft(env,crowded,request(i,[edit(i%2?'':contactLines,'replace',25)]));
 const storedPacked=db.prepare('SELECT state FROM drafts WHERE owner=?').get(crowded.id).state;
 same('large redacted history remains under storage limit with compact persistence',storedPacked.startsWith('gz1:')&&storedPacked.length<=950000,true);
 const loadedPacked=await getDraft(env,crowded);
 same('packed historical masks round-trip with unchanged text, timing and revision count',[loadedPacked.events.length,loadedPacked.activeMs,loadedPacked.text===maskPII(contactLines)],[11,275,true]);
 console.log(JSON.stringify({executed_at:new Date().toISOString(),environment:'Node 24, real draft API functions and SQLite; independently exercised shared playback helpers',passed:checks.length,checks,browser_testing:'Tracked separately in deployment acceptance'},null,2));
}finally{db.close();}
