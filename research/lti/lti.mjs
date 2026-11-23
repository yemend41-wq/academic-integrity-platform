// LTI 1.3 resource-link launches in top-level navigation, using the platform's signed ID token.
export const LTI_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS lti_handshakes (state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL, issuer TEXT NOT NULL, client_id TEXT NOT NULL, target_uri TEXT NOT NULL, deployment_hint TEXT NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS lti_handshakes_expiry ON lti_handshakes(expires_at)'
];
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
const MEMBERSHIP = 'http://purl.imsglobal.org/vocab/lis/v2/membership#';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const now = () => Math.floor(Date.now() / 1000);
const ttl = 600;
const alphabet = /^[a-zA-Z0-9_-]+$/;
const textField = (v, max=1024) => typeof v === 'string' && v.length > 0 && v.length <= max;
// Keep only a supported UI language from a signed launch, never the full user profile.
function launchLanguage(claims) {
  const requested = [claims[CLAIM + 'launch_presentation']?.locale, claims.locale];
  for (const locale of requested) {
    if (!textField(locale, 100)) continue;
    try {
      const language = new Intl.Locale(locale).language;
      if (language === 'ar' || language === 'en') return language;
    } catch {
      // The locale is optional. An invalid language tag cannot invalidate a course launch.
    }
  }
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => base64url(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
function decode(value) {
  if (!alphabet.test(value)) throw new Error('encoding');
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
}
class LtiError extends Error {
  constructor(code,status=400) { super(code); this.status=status; }
}
function fail(code,status) { throw new LtiError(code,status); }
function json(payload,status=200) {
  return Response.json(payload,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
function validEndpoint(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash;
  } catch { return false; }
}
function registry(env) {
  let rows;
  try { rows=JSON.parse(env.LTI_PLATFORMS || '[]'); } catch { fail('lti_configuration_invalid',503); }
  if(!Array.isArray(rows) || rows.some(p => !p || !validEndpoint(p.issuer) || !validEndpoint(p.authUrl) || !validEndpoint(p.jwksUrl) || !textField(p.clientId) || !Array.isArray(p.deploymentIds) || !p.deploymentIds.length || !p.deploymentIds.every(id=>textField(id)))) fail('lti_configuration_invalid',503);
  if(rows.length && (!env.DB || !textField(env.LTI_SUBJECT_KEY,8192) || encoder.encode(env.LTI_SUBJECT_KEY).length < 32)) fail('lti_configuration_incomplete',503);
  return rows;
}
async function input(req) {
  if(req.method === 'GET') return new URL(req.url).searchParams;
  if(req.method !== 'POST') fail('method_not_allowed',405);
  if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers.get('content-type')||'')) fail('lti_form_required',415);
  if(Number(req.headers.get('content-length')) > 32768) fail('form_too_large',413);
  const body = await boundedBody(req,32768,413);
  const params = new URLSearchParams(body);
  for(const k of new Set(params.keys())) if(params.getAll(k).length!==1) fail('ambiguous_parameter');
  return params;
}
async function boundedBody(msg, limit, status) {
  if(!msg.body)return '';
  let size=0; const chunks=[], reader=msg.body.getReader();
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel(); fail('message_too_large',status);}
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0;
  for(const item of chunks){bytes.set(item,offset); offset+=item.byteLength;}
  try{return decoder.decode(bytes);}catch{fail('invalid_utf8',status);}
}
function selectPlatform(platforms,issuer,clientId) {
  const matches=platforms.filter(p=>p.issuer===issuer && (!clientId||p.clientId===clientId));
  if(matches.length!==1) fail('unknown_or_ambiguous_platform',403);
  return matches[0];
}
const cookieName=state=>'__Host-lti-'+state.slice(0,20);
const cookie=(state,secret,age)=>cookieName(state)+'='+secret+'; Path=/; HttpOnly; Secure; SameSite=None; Max-Age='+age;
async function login(req, env, platforms, origin) {
  const p=await input(req);
  if([...new Set(p.keys())].some(k=>p.getAll(k).length!==1)) fail('ambiguous_parameter');
  const platform=selectPlatform(platforms,p.get('iss'),p.get('client_id'));
  const hint=p.get('login_hint'), target=p.get('target_link_uri'), dep=p.get('lti_deployment_id')||'';
  if(!textField(hint,4096)||!target||target!==origin+'/lti/launch' || (dep && !platform.deploymentIds.includes(dep)))fail('invalid_login_parameters');
  const state=random(), browser=random(), nonce=random();
  // Batch also performs bounded-by-TTL cleanup of abandoned launches.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM lti_handshakes WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO lti_handshakes VALUES (?,?,?,?,?,?,?,?)').bind(await hash(state),await hash(browser),nonce,platform.issuer,platform.clientId,target,dep,now()+ttl)
  ]);
  const dest=new URL(platform.authUrl);
  const fields={scope:'openid',response_type:'id_token',client_id:platform.clientId,redirect_uri:origin+'/lti/launch',login_hint:hint,state,nonce,response_mode:'form_post',prompt:'none'};
  if(p.has('lti_message_hint')) {
    if(!textField(p.get('lti_message_hint'),4096))fail('invalid_message_hint');
    fields.lti_message_hint=p.get('lti_message_hint');
  }
  for(const [k,v] of Object.entries(fields))dest.searchParams.set(k,v);
  return new Response(null,{status:303,headers:{Location:dest.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookie(state,browser,ttl)}});
}
async function verifySignedToken(compact,platform) {
  let header,payload,signature,parts;
  try {
    parts=compact.split('.');
    if(parts.length!==3)throw new Error();
    header=JSON.parse(decoder.decode(decode(parts[0])));
    payload=JSON.parse(decoder.decode(decode(parts[1])));
    signature=decode(parts[2]);
    if(!header || !payload || typeof payload!=='object' || Array.isArray(payload) || header.alg!=='RS256' || !textField(header.kid,256) || header.crit)throw new Error();
  } catch { fail('invalid_id_token',401); }
  let keys;
  try {
    const resp=await fetch(platform.jwksUrl,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
    if(!resp.ok)throw new Error();
    keys=JSON.parse(await boundedBody(resp,131072,503)).keys;
    if(!Array.isArray(keys))throw new Error();
  } catch {fail('platform_keys_unavailable',503);}
  const candidates=keys.filter(k=>k && k.kid===header.kid && k.kty==='RSA' && (!k.alg||k.alg==='RS256') && (!k.use||k.use==='sig') && (!k.key_ops||k.key_ops.includes('verify')));
  if(candidates.length!==1)fail('platform_signing_key_unknown',401);
  try{
    const key=await crypto.subtle.importKey('jwk',candidates[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(key.algorithm.modulusLength<2048 || !await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,encoder.encode(parts[0]+'.'+parts[1])))throw new Error();
  }catch{fail('signature_invalid',401);}
  return payload;
}
function recognizedIdentity(c,platform,row) {
  const aud=typeof c.aud==='string'?[c.aud]:c.aud;
  if(c.iss!==platform.issuer || !Array.isArray(aud) || !aud.includes(platform.clientId) || (aud.length>1 && c.azp!==platform.clientId) || (c.azp!==undefined && c.azp!==platform.clientId))fail('registration_mismatch',401);
  const time=now();
  if(!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.exp<=time||c.exp<=c.iat||c.iat>time+30||c.iat<time-ttl|| (c.nbf!==undefined && (!Number.isSafeInteger(c.nbf)||c.nbf>time+30)))fail('token_outside_validity',401);
  if(c.nonce!==row.nonce || c[CLAIM+'target_link_uri']!==row.target_uri)fail('launch_binding_mismatch',401);
  const deployment=c[CLAIM+'deployment_id'];
  if(c[CLAIM+'version']!=='1.3.0'||c[CLAIM+'message_type']!=='LtiResourceLinkRequest'||!platform.deploymentIds.includes(deployment)||(row.deployment_hint && row.deployment_hint!==deployment))fail('unsupported_launch',403);
  const resource=c[CLAIM+'resource_link']?.id, roles=c[CLAIM+'roles'], context=c[CLAIM+'context']?.id;
  if(!textField(resource)||!textField(c.sub,255)||!Array.isArray(roles)||!roles.every(x=>typeof x==='string')||(context!==undefined&&!textField(context)))fail('required_launch_claim_missing',403);
  const role=roles.includes(MEMBERSHIP+'Instructor')?'instructor':roles.includes(MEMBERSHIP+'Learner')?'student':null;
  if(!role)fail('course_role_required',403);
  return {role,resource,context,deployment};
}
async function launch(req,env,platforms,origin,onLaunch) {
  if(req.method!=='POST')fail('method_not_allowed',405);
  const p=await input(req), state=p.get('state'), token=p.get('id_token');
  if(!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !textField(token,30000))fail('incomplete_launch');
  const matchingCookies=(req.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName(state)+'='));
  if(matchingCookies.length!==1)fail('lti_browser_cookie_required',401);
  const browser=matchingCookies[0].slice(cookieName(state).length+1);
  const stateHash=await hash(state);
  const row=await env.DB.prepare('SELECT * FROM lti_handshakes WHERE state_hash=? AND browser_hash=? AND expires_at>=?').bind(stateHash,await hash(browser),now()).first();
  if(!row || row.target_uri!==origin+'/lti/launch')fail('launch_state_inactive',401);
  const platform=selectPlatform(platforms,row.issuer,row.client_id);
  const c=await verifySignedToken(token,platform);
  const {role,resource,context,deployment}=recognizedIdentity(c,platform,row);
  const hmacKey=await crypto.subtle.importKey('raw',encoder.encode(env.LTI_SUBJECT_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const pseudonym=async parts=>base64url(await crypto.subtle.sign('HMAC',hmacKey,encoder.encode(JSON.stringify([platform.issuer,platform.clientId,deployment,...parts]))));
  const [id,cohort]=await Promise.all([pseudonym(['user',c.sub]),pseudonym(context?['course',context]:['resource',resource])]);
  const consumed=await env.DB.prepare('DELETE FROM lti_handshakes WHERE state_hash=? AND expires_at>=? RETURNING state_hash').bind(stateHash,now()).first();
  if(!consumed)fail('launch_state_inactive',401);
  const principal={id:'lti-'+id,role,cohort:'lti-'+cohort,source:'lti'};
  const locale = launchLanguage(c);
  if (locale) principal.locale = locale;
  const result=onLaunch? await onLaunch(principal):json(principal);
  const response=new Response(result.body,result);
  response.headers.append('Set-Cookie',cookie(state,'',0));
  response.headers.set('Cache-Control','no-store');
  response.headers.set('Referrer-Policy','no-referrer');
  return response;
}
export async function handleLti(req, env, {onLaunch}={}) {
  const {origin,pathname}=new URL(req.url);
  if(!['/lti/config','/lti/login','/lti/launch'].includes(pathname))return null;
  try{
    const platforms=registry(env);
    if(pathname==='/lti/config'){
      if(req.method!=='GET')fail('method_not_allowed',405);
      return json({version:'1.3.0',message_type:'LtiResourceLinkRequest',registration_mode:'manual',
        initiate_login_uri:origin+'/lti/login',redirect_uri:origin+'/lti/launch',target_link_uri:origin+'/lti/launch',
        registered_platforms:platforms.length,launch_presentation:'new_window',document_target:'window'});
    }
    if(!platforms.length) fail('lti_platform_registration_required',503);
    if(pathname==='/lti/login')return await login(req,env,platforms,origin);
    return await launch(req,env,platforms,origin,onLaunch);
  }catch(e){if(e instanceof LtiError)return json({error:e.message},e.status);return json({error:'lti_service_unavailable'},503);}
}
