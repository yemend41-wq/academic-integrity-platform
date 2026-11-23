import {verifyReferences} from '../citations.mjs';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const text=['10.21105/joss.04886','10.1038/nature12373','10.99999/mizan-no-record-2026','ISBN 9780306406157','ISBN 9780306406158'].join('\n');
const actual=await verifyReferences(text),byId=Object.fromEntries(actual.map(row=>[row.id,row]));
const checks={
 liveKnownDoi:byId['10.1038/nature12373'].status==='verified',
 liveUnavailableDoi:byId['10.99999/mizan-no-record-2026'].status==='not_found',
 liveExistingIsbn:byId['9780306406157'].status==='verified',
 rejectInvalidChecksum:byId['9780306406158'].status==='invalid_checksum',
 localPublisherFallback:byId['10.21105/joss.04886'].status==='matched_publisher_snapshot'&&
   byId['10.21105/joss.04886'].registryStatus==='registry_unavailable',
};
const log={at:new Date().toISOString(),environment:'Work Node; production evidence recorded separately',checks,actual};
await fs.writeFile(fileURLToPath(new URL('registry-probe-results.json',import.meta.url)),JSON.stringify(log,null,2)+'\n');
console.log(checks);
