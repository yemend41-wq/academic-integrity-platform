// Large redacted detector views can share most of their bytes with the legacy
// extraction. Compress only the storage envelope; HTTP clients always get the original report.
const limit = 970000;
const utf8 = new TextEncoder();
export async function encodeReport(report) {
  const raw = JSON.stringify(report), bytes = utf8.encode(raw);
  if (bytes.length <= limit) return raw;
  if (bytes.length > 2300000) return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const deflated = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i=0;i<deflated.length;i+=8192) binary+=String.fromCharCode(...deflated.subarray(i,i+8192));
  const packed=JSON.stringify({privacyVersion:report.privacyVersion,encoding:"report-gzip-v1",data:btoa(binary)});
  return packed.length<=limit ? packed : null;
}

export async function decodeReport(encoded) {
  const data=JSON.parse(encoded);
  if (data.encoding !== "report-gzip-v1") return data;
  const bytes=Uint8Array.from(atob(data.data),char=>char.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
