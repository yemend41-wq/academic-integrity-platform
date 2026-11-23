"""Extract the normalized 3,000-word benchmark from a pinned public-domain edition."""
from hashlib import sha256
from pathlib import Path
import re
import sys

raw = Path(sys.argv[1]).read_bytes()
assert sha256(raw).hexdigest() == 'baf9b04fcf6e0008f30eaaa6697277751448c1070b20175e0082f28cbb161fd3'
text = raw.decode('utf-8-sig').replace('\r\n', '\n')
text = text[text.index('Call me Ishmael. Some years'):]
text = re.sub(r'^CHAPTER [^\n]+', '', text, flags=re.M)
text = text.replace('_', '').translate(str.maketrans({'‘':"'",'’':"'",'“':'"','”':'"','—':'-','–':'-'}))
# Split internal punctuation to eliminate differences between word-count definitions.
text = re.sub(r"(?<=[A-Za-z])[^A-Za-z\s]+(?=[A-Za-z])", ' ', text)
paragraphs = []
count = 0
for paragraph in re.split(r'\n\s*\n', text):
    words = []
    for token in paragraph.split():
        if not re.search('[A-Za-z]', token):
            continue
        # Retain accents from the source as their ASCII base letters.
        import unicodedata
        token = unicodedata.normalize('NFKD', token).encode('ascii','ignore').decode()
        words.append(token)
        count += 1
        if count == 3000:
            break
    if words:
        paragraphs.append(' '.join(words))
    if count == 3000:
        break
out = '\n\n'.join(paragraphs) + '\n'
assert len(out.split()) == len(re.findall('[A-Za-z]+',out)) == 3000
Path(__file__).with_name('melville-excerpt.txt').write_text(out, encoding='utf-8')
