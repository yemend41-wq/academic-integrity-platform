// Browser integration test for the actual application bundle, normal DOM controls and local SQLite.
// This script and the test session issuer are served only by the in-memory development runner.
const output=document.querySelector('pre'),results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
async function waitFor(fn){for(let i=0;i<180;i++){const v=fn();if(v)return v;await delay(100);}throw new Error('Timed out waiting for UI control');}
const assert=(x,msg)=>{if(!x)throw Error(msg)};
async function suite(width,lang){
 const f=document.querySelector('iframe');f.width=String(width);f.height='840';f.src='/';
 const doc=()=>f.contentDocument;
 await waitFor(()=>doc()?.getElementById('upload'));
 if(doc().documentElement.lang!==lang){doc().querySelector('#lang').click();await waitFor(()=>doc().documentElement.lang===lang&&doc().querySelector('#upload'));}
 const testCase=async(name,fn)=>{const x=await fn();results.push({width,lang,name,status:'passed',...x});output.textContent=JSON.stringify(results,null,2)};
 const b=await (await fetch('/__qa/fixture')).blob();
 await testCase('Upload a real 3,000-word DOCX in rendered controls',async()=>{
   const seed=await fetch('/api/analyze',{method:'POST',headers:{'x-format':'txt','x-index':'yes'},body:await (await fetch('/__qa/passage')).text()});
   assert(seed.status===201,'seed real reference in isolated cohort');
   const d=doc(),file=new f.contentWindow.File([b],'public-text.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
   const dt=new f.contentWindow.DataTransfer();dt.items.add(file);const input=d.querySelector('#file');input.files=dt.files;input.dispatchEvent(new f.contentWindow.Event('change',{bubbles:true}));
   d.querySelector('#upload').click();await waitFor(()=>d.querySelector('[data-tab="file"]'));
   assert(d.querySelector('.metric-grid').textContent.includes('3000'),'word count');const overflow=d.documentElement.scrollWidth-d.documentElement.clientWidth;assert(overflow<=2,'horizontal overflow '+overflow);return {sha256:await digest(await b.arrayBuffer()),overflow};
 });
 await testCase('Report tabs, exclusions, JSON and PDF controls',async()=>{
   const d=doc();const linked=d.querySelector('a[data-evidence]');assert(linked,'missing linked matching passage');
   linked.click();const pair=d.querySelector(linked.getAttribute('href'));assert(pair && pair.closest('details').open && pair.querySelector('blockquote').textContent.trim().length>20,'source passage open');
   d.querySelector('#rq').click();d.querySelector('#refilter').click();await waitFor(()=>!d.querySelector('#refilter')?.disabled);
   for(const tab of ['writing','file','refs','matches']){d.querySelector('[data-tab="'+tab+'"]').click();assert(d.querySelector('#detail').textContent.trim(),'empty tab');}
   assert(!d.querySelector('#rq').checked,'selected exclusions survived tab switch');
   const urls=[...d.querySelectorAll('a[download]')].map(a=>a.getAttribute('href'));
   assert(urls.length===3 && urls.some(s=>s.endsWith('lang=ar')) && urls.some(s=>s.endsWith('lang=en')),'bilingual export controls');
   let pdfCount=0;
   for(const url of urls){
     const response=await fetch(url);assert(response.ok,'export HTTP');
     if(url.includes('/pdf?')){const bytes=await response.arrayBuffer();assert(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-','PDF bytes');pdfCount++;}
     else assert((await response.json()).words===3000,'JSON content');
   }
   return {pdfCount,jsonOpened:true};
 });
 await testCase('Clarity entry, paste, save, playback and submission',async()=>{
  const d=doc();d.querySelector('[data-nav="clarity"]').click();const edit=await waitFor(()=>d.querySelector('textarea'));edit.focus();const prior=edit.value;
  edit.value=prior+' New bilingual draft. ';edit.dispatchEvent(new f.contentWindow.InputEvent('input',{bubbles:true,inputType:'insertText'}));edit.dispatchEvent(new f.contentWindow.Event('paste',{bubbles:true}));
  edit.value+='راجعت الطالبة المقال قبل تسليمه واحتفظت بملاحظات القراءة لشرح سبب التعديلات.';edit.dispatchEvent(new f.contentWindow.InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
  const save=[...d.querySelectorAll('button')].find(x=>['Save now','حفظ الآن'].includes(x.textContent));save.click();const slider=await waitFor(()=>{const s=d.querySelector('input[type="range"]');return s&&Number(s.max)>=2&&s});await waitFor(()=>save.disabled);
  slider.value='0';slider.dispatchEvent(new f.contentWindow.Event('input',{bubbles:true}));assert(['','—'].includes(d.querySelector('.clarity-preview[role=region]').textContent.trim()),'empty first frame');
  slider.value=slider.max;slider.dispatchEvent(new f.contentWindow.Event('input',{bubbles:true}));assert(d.querySelector('.clarity-preview[role=region]').textContent.includes('الطالبة'),'Arabic final frame');
  const submit=[...d.querySelectorAll('button')].find(x=>['Analyze draft','تحليل المسودة'].includes(x.textContent));submit.click();await waitFor(()=>d.querySelector('[data-tab=file]'));return {lastRevision:Number(slider.max)};
 });
 await testCase('Submissions, model card and health',async()=>{
  const d=doc();d.querySelector('[data-nav=records]').click();const search=await waitFor(()=>d.querySelector('#search'));await waitFor(()=>d.querySelector('[data-id]'));search.value='docx';search.dispatchEvent(new f.contentWindow.Event('input'));
  assert(d.querySelector('[data-id]'),'search found no document');d.querySelector('[data-nav=health]').click();await waitFor(()=>d.querySelector('.badge'));const overflow=d.documentElement.scrollWidth-d.documentElement.clientWidth;assert(overflow<=2,'horizontal overflow '+overflow);return {overflow};
 });
 await testCase('Sealed blind panel on the actual document',async()=>{
   const d=doc(),pane=d.querySelector('#blind-panel');assert(pane,'evaluator panel visible');
   pane.querySelector('details').open=true;
   const id=await digest(await b.arrayBuffer());
   const key=JSON.stringify({version:1,cases:[{sha256:id,language:'en',origin:'human',condition:'original',generatedPercent:0,authorGroup:'A1',sourceGroup:'S1'}]});
   const attach=(selector,bytes,name)=>{const transfer=new f.contentWindow.DataTransfer();transfer.items.add(new f.contentWindow.File([bytes],name));pane.querySelector(selector).files=transfer.files;};
   attach('[data-files]',b,'novel.docx');attach('[data-key]',key,'answers.json');
   pane.querySelector('[data-run]').click();await waitFor(()=>!pane.querySelector('[data-reveal]').hidden);
   assert(!pane.querySelector('tbody') && pane.querySelector('[data-key]').disabled,'decisions remain closed until opening');
   pane.querySelector('[data-reveal]').click();await waitFor(()=>pane.querySelector('tbody tr'));
   assert(!pane.querySelector('[data-save]').hidden,'private result export');
   return {files:1,viewports:[d.documentElement.clientWidth],sealedBeforeScoring:true};
 });
 f.src='about:blank';await waitFor(()=>!doc().querySelector('#frame'));
}
document.querySelector('button').onclick=async e=>{e.target.disabled=true;try{
 await suite(390,'ar');await suite(390,'en');await suite(1240,'en');await suite(1240,'ar');document.title='UI checks passed';document.querySelector('h1').textContent='UI checks passed';
}catch(e){results.push({status:'failed',detail:e.message});document.title='UI checks failed';document.querySelector('h1').textContent='UI checks failed';}
 output.textContent=JSON.stringify(results,null,2);await fetch('/__qa/results',{method:'POST',body:JSON.stringify(results)});};
