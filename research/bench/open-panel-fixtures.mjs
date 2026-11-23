/**
 * Fixed nonsensitive inputs for local-to-hosted panel conformance. Only the two
 * public licence texts and the original instrument descriptions below qualify.
 * Input shares are known by construction and are not an accuracy sample.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PUBLIC_SOURCES } from '../similarity/sources.mjs';
import { tokenize } from '../detector/features.mjs';
import { blindWritingScore } from '../../src/analysis.mjs';

const specs = {
  ar: {
    source: 'cc-by-4-ar', hash: '3501f76d921ad92b6b3331669472e9e0726694b4c933fa2f0c3ccbf5a40bdc6b',
    short: 'دوّن الراصد موضع الظل ثم أعاد القطعة إلى حافتها الأولى.',
    original: `داخل صندوق التجربة ثلاث صفائح من طين جاف، وفي طرف كل صفيحة ثقب ضيق. حين نثبت المصباح على الرف المقابل، يمر الضوء من الثقب وتظهر نقطة صغيرة على جدار الصندوق. نرسم تحت النقطة خطًا بالقلم كلما غيّرنا ارتفاع المصباح، حتى نحتفظ بأثر المواضع التي قطعها الضوء.
جاءت الفكرة من ملاحظة بسيطة. عند الظهر يبدو ظل حافة النافذة قصيرًا، لكنه يمتد على أرض الغرفة قبل الغروب. لذلك أضفنا إلى الصندوق مسطرة ورقية يمكن تحريكها فوق الأرضية. يضع القارئ المسطرة حيث ينتهي الظل، ويكتب قراءة واحدة في بطاقة تستقر أسفل الغطاء. إذا توقف الضوء عند شق في الورق، تُعاد المحاولة على صفيحة أخرى. لا نبحث عن تطابق القراءات جميعها. يكفينا أن نسجل السبب الذي جعل موضعين متجاورين يعطيان طولين مختلفين.`
  },
  en: {
    source: 'cc-by-4-en', hash: '80a50029a3d62311e106ad3997c2af2df41e8ff35501c8b904c486646f4c2ad1',
    short: 'The lamp moved and the chalk mark stayed beside the first tile.',
    original: `The tray carries three clay tiles and a shallow groove for a sliding lamp. A small aperture near the edge of each tile admits a narrow patch of light. Once the tray rests on a level shelf, a reader marks the far edge of the patch with a soft pencil. Moving the lamp along its groove changes the distance between that mark and the dark rim.
On the second pass the reader inserts a paper strip beneath the tile. A ruled border on the strip permits a reading even when the patch crosses a blemish in the clay. If the two readings differ, the reader records which rim looked sharpest and places a small dot next to that entry. Later a second reader can put the lamp back at the first notch without needing to guess which pencil stroke belonged to which observation.`
  }
};
// A dedicated regression case exercises the public asterisk band. Its selection
// was functional and it never contributes to a detector accuracy statistic.
const artificialGarden = 'في مدينة خيالية عمل ثلاثة بستانيين على بناء نموذج لحديقة مصغرة تحتوي على مجموعة متنوعة من النباتات. يمكن أن يساعد بناء هذا النموذج في تعزيز مهارات التفكير النقدي لدى الطلاب، بالإضافة إلى تنمية الوعي البيئي وتحسين جودة التعليم. على سبيل المثال، يستطيع الطالب مقارنة احتياجات النباتات المختلفة وتحديد العلاقة بين كمية الضوء ومعدل النمو. ويمكنه تدوين النتائج في سجل خاص بالحديقة ومشاركة ملاحظاته مع زملائه.';
const sha256 = text => createHash('sha256').update(text).digest('hex');
const encode = text => new TextEncoder().encode(text);

function prefix(text, number) {
  const words = tokenize(text);
  assert.ok(words.length >= number);
  return text.slice(words[0].start, words[number]?.start ?? text.length).trimEnd();
}

export async function openPanelFixtures(includeText = false) {
  const entries = [];
  async function append(id, language, kind, text, meta = {}) {
    const bytes = encode(text), local = await blindWritingScore(bytes, 'txt');
    assert.equal(local.sha256, sha256(text));
    assert.deepEqual(Object.keys(local).sort(), ['display','eligibleWords','model','sha256','status']);
    if (kind === 'short') {
      assert.equal(local.status, 'insufficient');
      assert.equal(local.display, null);
      assert.equal(local.eligibleWords, 0);
    } else {
      assert.ok(local.eligibleWords >= 48);
      assert.ok(local.status === 'suppressed' ? local.display === '*%' : /^\d+%$/.test(local.display));
    }
    const row = {id, language, kind, format:'txt', bytes:bytes.length, sha256:local.sha256, words:tokenize(text).length, ...meta, expected:local};
    entries.push(includeText ? {...row, text} : row);
  }
  for (const [language, spec] of Object.entries(specs)) {
    const source = PUBLIC_SOURCES.find(item => item.id === spec.source);
    assert.ok(source && source.lang === language && sha256(source.text) === spec.hash);
    await append(language + '-license', language, 'public-license', source.text, {source:source.url});
    await append(language + '-original', language, 'original-artificial', spec.original);
    await append(language + '-short', language, 'short', spec.short);
    for (const share of [25,50,75]) {
      const total = 96, originalWords = total * share / 100, licenseWords = total - originalWords;
      const parts = [prefix(source.text, licenseWords), prefix(spec.original, originalWords)];
      if (share === 50) parts.reverse();
      const text = parts.join('\n');
      assert.equal(tokenize(text).length, total);
      await append(language + '-mix-' + share, language, 'controlled-splice', text,
        {source:source.url, total, originalWords, licenseWords, originalWordShare:share});
    }
    if (language === 'ar') {
      await append('ar-numeric-control', language, 'positive-control', artificialGarden);
      assert.ok(/^([2-9]\d|100)%$/.test(entries.at(-1).expected.display));
      await append('ar-suppression-control', language, 'suppression-control',
        prefix(source.text, 540) + '\n' + artificialGarden, {source:source.url});
      assert.equal(entries.at(-1).expected.display, '*%');
    }
  }
  assert.equal(new Set(entries.map(item => item.sha256)).size, entries.length);
  const commitment = sha256(JSON.stringify(entries.map(({id,sha256,expected})=>[id,sha256,expected])));
  return {schema:1, scope:'Functional agreement only for fixed public licence texts and authored artificial fixtures.', commitment, entries};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--payload'));
  console.log(JSON.stringify(await openPanelFixtures(process.argv[2] === '--payload')));
}
