import{o as e}from"./rolldown-runtime-DAXXjFlN.js";import{t}from"./document-DtShbZBC.js";import{t as n}from"./jszip.min-BLkjhX6R.js";var r=e(n());function i(e){let t=new DOMParser().parseFromString(e,`application/xml`);if(t.getElementsByTagName(`parsererror`).length)throw Error(`OPF XML 解析失败`);let n=new Map,r=t.getElementsByTagName(`manifest`)[0];if(r){let e=r.getElementsByTagName(`item`);for(let t of e){let e=t.getAttribute(`id`),r=t.getAttribute(`href`),i=t.getAttribute(`media-type`)||``;e&&r&&n.set(e,{href:r,mediaType:i})}}let i=[],a=t.getElementsByTagName(`spine`)[0];if(a){let e=a.getElementsByTagName(`itemref`);for(let t of e){let e=t.getAttribute(`idref`);e&&i.push(e)}}return{manifest:n,spine:i}}function a(e){let t=new DOMParser().parseFromString(e,`application/xml`).getElementsByTagName(`rootfile`);if(t.length===0)throw Error(`container.xml 缺少 rootfile`);return t[0].getAttribute(`full-path`)}function o(e,t=`html`){let n=new DOMParser().parseFromString(e,`application/xhtml+xml`);if(n.getElementsByTagName(`parsererror`).length){let n=new DOMParser().parseFromString(e,`text/html`).body;return n?t===`text`?n.textContent:n.innerHTML:``}let r=n.getElementsByTagName(`body`)[0];return r?t===`text`?r.textContent||``:r.innerHTML||``:``}function s(e,t){let n=t.replace(/^\.\//,``),r=e?e.split(`/`):[];for(let e of n.split(`/`))if(!(e===``||e===`.`)){if(e===`..`){r.pop();continue}r.push(e)}return r.join(`/`)}function c(e){return{png:`image/png`,jpg:`image/jpeg`,jpeg:`image/jpeg`,gif:`image/gif`,webp:`image/webp`,bmp:`image/bmp`,svg:`image/svg+xml`,avif:`image/avif`,tiff:`image/tiff`}[(e.split(`.`).pop()||``).toLowerCase()]||`application/octet-stream`}async function l(e,t,n){let r=new DOMParser().parseFromString(`<div>${e}</div>`,`text/html`),i=r.querySelectorAll(`img`);for(let e of i){let r=e.getAttribute(`src`);if(!r||/^(data:|https?:|blob:|mailto:)/i.test(r))continue;let i=decodeURIComponent(r.split(`#`)[0].split(`?`)[0]),a=s(n,i),o=t.file(a)||t.file(i);if(o)try{let t=await o.async(`base64`);e.setAttribute(`src`,`data:${c(a)};base64,${t}`)}catch{}}return r.body.firstElementChild?.innerHTML??e}async function u(e,t){t(`读取 EPUB 文件...`,``,10);let n=await r.default.loadAsync(await e.arrayBuffer()),s=0,c=512*1024*1024;if(n.forEach((e,t)=>{t.dir||(s+=t._data&&t._data.uncompressedSize||0)}),s>c)throw Error(`EPUB 解压后体积约 ${(s/1024/1024).toFixed(0)}MB，超过 ${c/1024/1024}MB 安全上限，可能是压缩包炸弹或异常文件`);t(`解析目录结构...`,``,25);let u=n.file(`META-INF/container.xml`);if(!u)throw Error(`不是有效的 EPUB：缺少 META-INF/container.xml`);let d=a(await u.async(`string`)),f=n.file(d);if(!f)throw Error(`OPF 文件不存在: ${d}`);let{manifest:p,spine:m}=i(await f.async(`string`));if(m.length===0)throw Error(`OPF spine 为空`);let h=d.includes(`/`)?d.replace(/\/[^/]*$/,``):``,g=[];t(`提取章节内容...`,``,40);for(let e=0;e<m.length;e++){let r=p.get(m[e]);if(!r)continue;let i=decodeURIComponent(r.href),a=h?`${h}/${i}`:i,s=n.file(a)||n.file(i);if(!s)continue;let c=await s.async(`string`),u=await l(o(c,`html`),n,a.includes(`/`)?a.replace(/\/[^/]*$/,``):``),d=o(c,`text`);g.push({html:u,text:d}),t(`提取章节 ${e+1}/${m.length}...`,``,40+Math.round((e+1)/m.length*50))}if(g.length===0)throw Error(`未提取到任何章节内容`);return g}async function d(e){let{files:t,setProgress:n,getBaseName:r}=e,i=t[0],a=await u(i,n);return n(`完成`,``,100),{text:a.map(e=>e.text.trim()).filter(Boolean).join(`

---

`),filename:`${r(i.name)}.txt`}}async function f(e){let{files:n,setProgress:r,getBaseName:i}=e,a=n[0],o=await u(a,r);r(`生成 HTML...`,``,95);let s=o.map(e=>e.html.trim()).filter(Boolean).join(`
<hr>
`),c=`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${t(i(a.name))}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 2em auto; padding: 0 1em; }
hr { margin: 2em 0; border: none; border-top: 1px solid #ccc; }
img { max-width: 100%; }
h1, h2, h3 { color: #333; }
</style>
</head>
<body>
${s}
</body>
</html>`;return r(`完成`,``,100),{text:c,filename:`${i(a.name)}.html`}}var p={"epub-to-text":d,"epub-to-html":f};export{p as HANDLERS,f as epubToHtml,d as epubToText};