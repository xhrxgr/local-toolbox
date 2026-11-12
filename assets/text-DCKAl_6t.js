import{t as e}from"./common-Ir7JNMuE.js";import{r as t,t as n}from"./clipboard-C24IsV_E.js";var r=new Intl.Collator;function i(e){let t=``;for(let n=e.length-1;n>=0;n--){let r=e.charCodeAt(n);r>=56320&&r<=57343&&n>0?(t+=e[n-1]+e[n],n--):t+=e[n]}return t}function a(){let e=e=>document.getElementById(e),a=e(`text-input`),o=e(`text-output`),s=e(`text-op`),c=e(`text-stats`),l=e(`replace-options`),u=e(`prefix-options`),d=e(`suffix-options`),f=e(`text-meta`);function p(){let t=s.value;l.hidden=!(t===`replace`||t===`replace-regex`),u.hidden=t!==`add-prefix`,d.hidden=t!==`add-suffix`,e(`replace-ci-wrap`).hidden=t!==`replace`,c.hidden=!0}s.addEventListener(`change`,p);function m(){let t=a.value,n=s.value,c=``,l=``;try{switch(n){case`stats`:h(t),o.value=``;return;case`upper`:c=t.toUpperCase();break;case`lower`:c=t.toLowerCase();break;case`title`:c=t.replace(/\b\w/g,e=>e.toUpperCase());break;case`sentence`:c=t.replace(/(^\s*|[.!?。！？]\s+)([a-z\u4e00-\u9fa5])/g,(e,t,n)=>t+n.toUpperCase());break;case`camel`:c=t.split(/[\s_-]+/).filter(Boolean).map((e,t)=>t===0?e.toLowerCase():e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join(``);break;case`snake`:c=t.trim().split(/[\s-]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`_`);break;case`kebab`:c=t.trim().split(/[\s_]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`-`);break;case`dedup-line`:c=g(t,!1);break;case`dedup-line-sort`:c=g(t,!0);break;case`sort-asc`:c=t.split(`
`).sort(r.compare).join(`
`);break;case`sort-desc`:c=t.split(`
`).sort((e,t)=>r.compare(t,e)).join(`
`);break;case`sort-len`:c=t.split(`
`).sort((e,t)=>e.length-t.length).join(`
`);break;case`reverse-line`:c=t.split(`
`).map(i).join(`
`);break;case`reverse-all`:c=i(t);break;case`reverse-line-order`:c=t.split(`
`).reverse().join(`
`);break;case`remove-empty`:c=t.split(`
`).filter(e=>e.trim()!==``).join(`
`);break;case`trim-line`:c=t.split(`
`).map(e=>e.trim()).join(`
`);break;case`tab-to-space`:c=t.replace(/\t/g,`    `);break;case`space-to-tab`:c=t.replace(/    /g,`	`);break;case`replace`:{let n=e(`replace-from`).value,r=e(`replace-to`).value,i=e(`replace-global`).checked,a=e(`replace-ci`).checked;if(!n){c=t;break}let o=(i?`g`:``)+(a?`i`:``),s=new RegExp(_(n),o);c=t.replace(s,r),l=`替换了 ${(t.match(new RegExp(_(n),`g`+(a?`i`:``)))||[]).length} 处`;break}case`replace-regex`:{let n=e(`replace-from`).value,r=e(`replace-to`).value,i=e(`replace-global`).checked;if(!n){c=t;break}let a=i?`g`:``,o=n.match(/^\/(.+)\/([gimsuy]*)$/),s;try{s=o?new RegExp(o[1],o[2]+(i&&!o[2].includes(`g`)?`g`:``)):new RegExp(n,a)}catch(e){l=`正则错误：`+e.message,c=t;break}c=t.replace(s,r),l=`替换了 ${(t.match(s.global?s:new RegExp(s.source,s.flags+`g`))||[]).length} 处`;break}case`add-prefix`:{let n=e(`prefix-text`).value;c=t.split(`
`).map(e=>n+e).join(`
`);break}case`add-suffix`:{let n=e(`suffix-text`).value;c=t.split(`
`).map(e=>e+n).join(`
`);break}case`add-line-num`:{let e=t.split(`
`),n=String(e.length).length;c=e.map((e,t)=>`${String(t+1).padStart(n,`0`)}  ${e}`).join(`
`);break}case`remove-duplicate-chars`:c=t.replace(/(.)\1+/g,`$1`);break;default:c=t}}catch(e){l=`错误：`+e.message,c=t}o.value=c,f.textContent=l}function h(t){let n=t.split(`
`),r=n.filter(e=>e.trim()!==``).length,i=t.length,a=t.replace(/\s/g,``).length,o=(t.match(/[a-zA-Z0-9_]+/g)||[]).length+(t.match(/[\u4e00-\u9fa5]/g)||[]).length,s=new TextEncoder().encode(t).length;e(`stat-chars`).textContent=i,e(`stat-chars-nospace`).textContent=a,e(`stat-words`).textContent=o,e(`stat-lines`).textContent=n.length,e(`stat-nonempty`).textContent=r,e(`stat-bytes`).textContent=s,c.hidden=!1,f.textContent=`共 ${n.length} 行 / ${o} 词 / ${i} 字符 / ${s} 字节`}function g(e,t){let n=new Set,r=[];for(let t of e.split(`
`))n.has(t)||(n.add(t),r.push(t));return t&&r.sort((e,t)=>e.localeCompare(t)),r.join(`
`)}function _(e){return e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`)}e(`btn-run`).addEventListener(`click`,m),e(`btn-swap`).addEventListener(`click`,()=>{o.value&&(a.value=o.value,o.value=``,f.textContent=`已用结果替换输入`)}),e(`btn-clear`).addEventListener(`click`,()=>{a.value=``,o.value=``,c.hidden=!0,f.textContent=``}),e(`btn-copy`).addEventListener(`click`,async()=>{if(!o.value){t(e(`btn-copy`),`请先执行`);return}let r=await n(o.value),i=e(`btn-copy`),a=i.textContent;i.textContent=r?`已复制`:`复制失败`,i.classList.add(r?`meta-btn--success`:`meta-btn--danger`),setTimeout(()=>{i.textContent=a,i.classList.remove(`meta-btn--success`,`meta-btn--danger`)},1500)}),a.addEventListener(`keydown`,e=>{e.ctrlKey&&e.key===`Enter`&&m()}),p()}document.addEventListener(`DOMContentLoaded`,()=>{e(`文本工具`),a()});