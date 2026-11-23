import fs from 'node:fs';
import readline from 'node:readline';
import {tokenize,windows,vector} from './features.mjs';
const reader=readline.createInterface({input:fs.createReadStream(process.argv[2]),crlfDelay:Infinity});
for await(const line of reader) {
  const {text,...meta}=JSON.parse(line);
  const words=tokenize(text);
  const features=windows(words).filter(w=>w.lang===meta.lang).map(w=>vector(words,w.from,w.to));
  console.log(JSON.stringify({...meta,features}));
}
