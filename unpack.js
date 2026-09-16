const fs=require('fs'),path=require('path'),zlib=require('zlib');
const dir=path.join(__dirname,'payload');
const b64=fs.readdirSync(dir).filter(x=>x.endsWith('.part')).sort().map(x=>fs.readFileSync(path.join(dir,x),'utf8')).join('');
const files=JSON.parse(zlib.gunzipSync(Buffer.from(b64,'base64')).toString('utf8'));
for(const [name,data] of Object.entries(files)){const out=path.join(__dirname,name);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,data)}
console.log(`Restored ${Object.keys(files).length} source files`);
