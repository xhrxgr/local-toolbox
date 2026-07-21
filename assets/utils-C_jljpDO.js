const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/jspdf.es.min-zxxqWQMf.js","assets/rolldown-runtime-BHe-jwch.js","assets/document-CL2w-3bQ.js","assets/common-fvDkMcza.js","assets/common-BF3WOA9q.css","assets/document-k3Z0D_KS.css","assets/typeof-B5XbjTb1.js","assets/html2canvas-C7amaW1D.js"])))=>i.map(i=>d[i]);
import{r as e}from"./rolldown-runtime-BHe-jwch.js";import{t}from"./document-CL2w-3bQ.js";function n(e){return e.replace(/\.[^.]+$/,``)}async function r(n,r){let[{default:i},{default:a}]=await Promise.all([t(()=>import(`./jspdf.es.min-zxxqWQMf.js`),__vite__mapDeps([0,1,2,3,4,5,6])),t(()=>import(`./html2canvas-C7amaW1D.js`).then(t=>e(t.default)),__vite__mapDeps([7,1]))]),o=document.createElement(`div`);o.style.cssText=`
    position: fixed; left: -9999px; top: 0; width: 794px; padding: 32px;
    background: #ffffff; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.6; font-size: 14px;
  `,o.innerHTML=`
    <style>
      h1 { font-size: 1.8em; margin: 0.6em 0 0.3em; }
      h2 { font-size: 1.5em; margin: 0.6em 0 0.3em; }
      h3 { font-size: 1.2em; margin: 0.6em 0 0.3em; }
      p { margin: 0.6em 0; }
      code { font-family: Consolas, monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
      pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
      pre code { background: none; color: inherit; padding: 0; }
      blockquote { border-left: 3px solid #6366f1; padding-left: 12px; color: #6b7280; margin: 0.6em 0; }
      table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
      th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
      th { background: #f1f5f9; }
      ul, ol { padding-left: 24px; }
      img { max-width: 100%; }
    </style>
    ${n}
  `,document.body.appendChild(o);try{let e=await a(o,{scale:2,useCORS:!0,backgroundColor:`#ffffff`}),t=new i({unit:`pt`,format:`a4`}),n=t.internal.pageSize.getWidth(),r=t.internal.pageSize.getHeight(),s=n,c=e.height*s/e.width,l=c,u=0,d=e.toDataURL(`image/jpeg`,.95);for(t.addImage(d,`JPEG`,0,u,s,c),l-=r;l>0;)u=l-c,t.addPage(),t.addImage(d,`JPEG`,0,u,s,c),l-=r;return t.output(`blob`)}finally{document.body.removeChild(o)}}export{r as n,n as t};