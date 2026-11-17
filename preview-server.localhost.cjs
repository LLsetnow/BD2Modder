const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/__health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({app:'modstudio-html-draft'}));}
 let decoded;try{decoded=decodeURIComponent(pathname);}catch{res.writeHead(400);return res.end();}
 if(decoded==='/'){res.writeHead(302,{Location:encodeURI('/draft/ModStudio 工作台草案.html')});return res.end();}
 if(!decoded.startsWith('/draft/')&&!decoded.startsWith('/assets/')){res.writeHead(404);return res.end();}
 const file=path.resolve(root,'.'+decoded);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
 });
}).listen(8765,'127.0.0.1');
