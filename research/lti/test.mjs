// Real signatures, TLS JWKS transport and SQLite. Credentials exist only in this test process.
import { strict as assert } from 'node:assert';
import { createServer } from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleLti } from './lti.mjs';

if(!process.env.LTI_TEST_CERT_DIR){
  const scratch=mkdtempSync(join(tmpdir(),'lti-lab-'));
  try{
    const args=['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'ca.pem')];
    assert.equal(spawnSync('openssl',args,{stdio:'ignore'}).status,0);
    const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{stdio:'inherit',env:{...process.env,LTI_TEST_CERT_DIR:scratch,NODE_EXTRA_CA_CERTS:join(scratch,'ca.pem')}});
    process.exitCode=run.status??1;
  } finally {rmSync(scratch,{recursive:true,force:true});}
}else{
  const suite=await exercise();
  console.log(JSON.stringify(suite,null,2));
}

async function exercise(){
  const stamped=new Date().toISOString(), checks=[];
  const keyPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
  const pub=await crypto.subtle.exportKey('jwk',keyPair.publicKey);
  const tls=process.env.LTI_TEST_CERT_DIR;
  const keyServer=createServer({key:readFileSync(join(tls,'key.pem')),cert:readFileSync(join(tls,'ca.pem'))},(req,res)=>{
    if(req.url!=='/keys'){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({keys:[{...pub,kid:'semester-1',use:'sig',alg:'RS256'}]}));
  });
  await new Promise(resolve=>keyServer.listen(0,'127.0.0.1',resolve));
  const db=new DatabaseSync(':memory:');
  const file=new URL('./schema.sql',import.meta.url);
  db.exec(readFileSync(file,'utf8'));
  const DB={
    prepare(sql){return {bind(...values){return {first:async()=>db.prepare(sql).get(...values),run:async()=>db.prepare(sql).run(...values)};}};},
    async batch(items){db.exec('BEGIN');try{for(const item of items)await item.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  };
  const issuer='https://127.0.0.1:'+keyServer.address().port;
  const site='https://integrity.example', target=site+'/lti/launch', claim='https://purl.imsglobal.org/spec/lti/claim/';
  const platforms=[{issuer,clientId:'science',authUrl:issuer+'/authorize',jwksUrl:issuer+'/keys',deploymentIds:['term-A']}];
  const env={DB,LTI_PLATFORMS:JSON.stringify(platforms),LTI_SUBJECT_KEY:crypto.randomUUID()};
  function check(label,value,expected){assert.deepEqual(value,expected,label);checks.push(label);}
  const loginParams={iss:issuer,client_id:'science',lti_deployment_id:'term-A',login_hint:'opaque-browser-subject',target_link_uri:target,lti_message_hint:'resource-7'};
  async function login(post=false){
    const q=new URLSearchParams(loginParams);
    const req=post?new Request(site+'/lti/login',{method:'POST',body:q}):new Request(site+'/lti/login?'+q);
    const r=await handleLti(req,env);
    assert.equal(r.status,303);
    const cookie=r.headers.get('set-cookie').split(';')[0],loc=new URL(r.headers.get('location'));
    return {cookie,loc,state:loc.searchParams.get('state'),nonce:loc.searchParams.get('nonce')};
  }
  const member='http://purl.imsglobal.org/vocab/lis/v2/membership#';
  async function prepare(state,patch={}){
    const t=Math.floor(Date.now()/1000);
    const payload={iss:issuer,sub:'person@example.org',aud:'science',exp:t+90,iat:t,nonce:state.nonce,[claim+'deployment_id']:'term-A',[claim+'resource_link']:{id:'assignment-42'},[claim+'roles']:[member+'Instructor'],[claim+'target_link_uri']:target,[claim+'context']:{id:'course-123'},[claim+'message_type']:'LtiResourceLinkRequest',[claim+'version']:'1.3.0',...patch};
    const encoded=s=>Buffer.from(JSON.stringify(s)).toString('base64url');
    const input=encoded({kid:'semester-1',alg:'RS256'})+'.'+encoded(payload);
    return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keyPair.privateKey,Buffer.from(input))).toString('base64url');
  }
  async function send(st,signed,cookie=st.cookie){
    return handleLti(new Request(target,{method:'POST',body:new URLSearchParams({state:st.state,id_token:signed}),headers:{cookie}}),env);
  }
  try{
    const config=await handleLti(new Request(site+'/lti/config'),{});
    check('unregistered deployment configuration is explicit',(await config.json()).registered_platforms,0);
    check('unregistered login unavailable',(await handleLti(new Request(site+'/lti/login'),{})).status,503);
    const st=await login();
    check('GET initiation and OIDC parameters',[st.loc.origin,st.loc.searchParams.get('redirect_uri'),st.loc.searchParams.get('scope'),st.loc.searchParams.get('response_mode'),st.loc.searchParams.get('prompt'),st.loc.searchParams.get('lti_message_hint')],[issuer,target,'openid','form_post','none','resource-7']);
    const signed=await prepare(st);
    check('cookie bound state required',(await send(st,signed,'')).status,401);
    const r=await send(st,signed),identity=await r.json();
    check('signed instructor launch',[r.status,identity.role,identity.source],[200,'instructor','lti']);
    check('an omitted optional locale preserves the default experience',identity.locale,undefined);
    for (const [title, presentation, profileLocale, expected] of [
      ['Arabic presentation language takes priority', 'ar-OM', 'en-GB', 'ar'],
      ['English launch uses an English interface', 'en-GB', 'ar-OM', 'en'],
      ['Invalid presentation tag falls back to supported profile language', 'invalid tag', 'ar-AE', 'ar'],
      ['Unserved languages leave the local preference available', 'de-DE', 'fr-FR', undefined],
    ]) {
      const flow = await login();
      const localized = await send(flow, await prepare(flow, {
        [claim+'launch_presentation']: {document_target: 'window', locale: presentation},
        locale: profileLocale,
      }));
      check(title, [localized.status, (await localized.json()).locale], [200, expected]);
    }
    check('pseudonyms replace raw user and course',/^lti-[\w-]{43}$/.test(identity.id)&&/^lti-[\w-]{43}$/.test(identity.cohort)&&!JSON.stringify(identity).includes('@'),true);
    check('single-use accepted launch',(await send(st,signed)).status,401);
    const st2=await login(true);
    const fresh=await send(st2,await prepare(st2,{[claim+'roles']:[member+'Learner']}));
    const student=await fresh.json();
    check('POST initiation, learner role, stable scoped identity',[fresh.status,student.role,student.id,student.cohort],[200,'student',identity.id,identity.cohort]);
    for(const [name,patch,expected] of [
      ['expired assertion rejected',{exp:Math.floor(Date.now()/1000)-1},401],
      ['unknown deployment rejected',{[claim+'deployment_id']:'other-term'},403],
      ['audience mismatch rejected',{aud:'other-client'},401],
      ['multiple audiences require authorized party',{aud:['science','aux']},401],
      ['nonce mismatch rejected',{nonce:'unrelated-state'},401],
      ['unknown course role rejected',{[claim+'roles']:[member+'Observer']},403]
    ]){const s=await login();check(name,(await send(s,await prepare(s,patch))).status,expected);}
    const st3=await login(),concurrent=await prepare(st3);
    const simultaneous=await Promise.all([send(st3,concurrent),send(st3,concurrent)]);
    check('concurrent duplicate completion consumed once',simultaneous.map(x=>x.status).sort(),[200,401]);
    const st4=await login();
    const course2=await send(st4,await prepare(st4,{[claim+'context']:{id:'course-124'}}));
    check('course isolation uses separate pseudonym',(await course2.json()).cohort!==identity.cohort,true);
    return {executed_at:stamped,environment:'Node Web Crypto, real local TLS JWKS, SQLite in memory, D1 adapter',passed:checks.length,checks,external_lms_status:'not registered or tested'};
  }finally{db.close();keyServer.closeAllConnections();await new Promise(resolve=>keyServer.close(resolve));}
}
