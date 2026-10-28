import{t as e}from"./common-Csr89AbW.js";import{n as t,t as n}from"./clipboard-yAVHF97_.js";function r(){let e=e=>document.getElementById(e),r=e(`text-input`),i=e(`text-output`),a=e(`text-op`),o=e(`text-stats`),s=e(`replace-options`),c=e(`prefix-options`),l=e(`suffix-options`),u=e(`text-meta`);function d(){let t=a.value;s.hidden=!(t===`replace`||t===`replace-regex`),c.hidden=t!==`add-prefix`,l.hidden=t!==`add-suffix`,e(`replace-ci-wrap`).hidden=t!==`replace`,o.hidden=!0}a.addEventListener(`change`,d);function f(){let t=r.value,n=a.value,o=``,s=``;try{switch(n){case`stats`:p(t),i.value=``;return;case`upper`:o=t.toUpperCase();break;case`lower`:o=t.toLowerCase();break;case`title`:o=t.replace(/\b\w/g,e=>e.toUpperCase());break;case`sentence`:o=t.replace(/(^\s*|[.!?。！？]\s+)([a-z\u4e00-\u9fa5])/g,(e,t,n)=>t+n.toUpperCase());break;case`camel`:o=t.split(/[\s_-]+/).filter(Boolean).map((e,t)=>t===0?e.toLowerCase():e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join(``);break;case`snake`:o=t.trim().split(/[\s-]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`_`);break;case`kebab`:o=t.trim().split(/[\s_]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`-`);break;case`dedup-line`:o=m(t,!1);break;case`dedup-line-sort`:o=m(t,!0);break;case`sort-asc`:o=t.split(`
`).sort((e,t)=>e.localeCompare(t)).join(`
`);break;case`sort-desc`:o=t.split(`
`).sort((e,t)=>t.localeCompare(e)).join(`
`);break;case`sort-len`:o=t.split(`
`).sort((e,t)=>e.length-t.length).join(`
`);break;case`reverse-line`:o=t.split(`
`).map(e=>[...e].reverse().join(``)).join(`
`);break;case`reverse-all`:o=[...t].reverse().join(``);break;case`reverse-line-order`:o=t.split(`
`).reverse().join(`
`);break;case`remove-empty`:o=t.split(`
`).filter(e=>e.trim()!==``).join(`
`);break;case`trim-line`:o=t.split(`
`).map(e=>e.trim()).join(`
`);break;case`tab-to-space`:o=t.replace(/\t/g,`    `);break;case`space-to-tab`:o=t.replace(/    /g,`	`);break;case`replace`:{let n=e(`replace-from`).value,r=e(`replace-to`).value,i=e(`replace-global`).checked,a=e(`replace-ci`).checked;if(!n){o=t;break}let c=(i?`g`:``)+(a?`i`:``),l=new RegExp(h(n),c);o=t.replace(l,r),s=`替换了 ${(t.match(new RegExp(h(n),`g`+(a?`i`:``)))||[]).length} 处`;break}case`replace-regex`:{let n=e(`replace-from`).value,r=e(`replace-to`).value,i=e(`replace-global`).checked;if(!n){o=t;break}let a=i?`g`:``,c=n.match(/^\/(.+)\/([gimsuy]*)$/),l;try{l=c?new RegExp(c[1],c[2]+(i&&!c[2].includes(`g`)?`g`:``)):new RegExp(n,a)}catch(e){s=`正则错误：`+e.message,o=t;break}o=t.replace(l,r),s=`替换了 ${(t.match(l.global?l:new RegExp(l.source,l.flags+`g`))||[]).length} 处`;break}case`add-prefix`:{let n=e(`prefix-text`).value;o=t.split(`
`).map(e=>n+e).join(`
`);break}case`add-suffix`:{let n=e(`suffix-text`).value;o=t.split(`
`).map(e=>e+n).join(`
`);break}case`add-line-num`:{let e=t.split(`
`),n=String(e.length).length;o=e.map((e,t)=>`${String(t+1).padStart(n,`0`)}  ${e}`).join(`
`);break}case`remove-duplicate-chars`:o=t.replace(/(.)\1+/g,`$1`);break;default:o=t}}catch(e){s=`错误：`+e.message,o=t}i.value=o,u.textContent=s}function p(t){let n=t.split(`
`),r=n.filter(e=>e.trim()!==``).length,i=t.length,a=t.replace(/\s/g,``).length,s=(t.match(/[a-zA-Z0-9_]+/g)||[]).length+(t.match(/[\u4e00-\u9fa5]/g)||[]).length,c=new TextEncoder().encode(t).length;e(`stat-chars`).textContent=i,e(`stat-chars-nospace`).textContent=a,e(`stat-words`).textContent=s,e(`stat-lines`).textContent=n.length,e(`stat-nonempty`).textContent=r,e(`stat-bytes`).textContent=c,o.hidden=!1,u.textContent=`共 ${n.length} 行 / ${s} 词 / ${i} 字符 / ${c} 字节`}function m(e,t){let n=new Set,r=[];for(let t of e.split(`
`))n.has(t)||(n.add(t),r.push(t));return t&&r.sort((e,t)=>e.localeCompare(t)),r.join(`
`)}function h(e){return e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`)}e(`btn-run`).addEventListener(`click`,f),e(`btn-swap`).addEventListener(`click`,()=>{i.value&&(r.value=i.value,i.value=``,u.textContent=`已用结果替换输入`)}),e(`btn-clear`).addEventListener(`click`,()=>{r.value=``,i.value=``,o.hidden=!0,u.textContent=``}),e(`btn-copy`).addEventListener(`click`,async()=>{if(!i.value){t(e(`btn-copy`),`请先执行`);return}let r=await n(i.value),a=e(`btn-copy`),o=a.textContent;a.textContent=r?`已复制`:`复制失败`,a.classList.add(r?`meta-btn--success`:`meta-btn--danger`),setTimeout(()=>{a.textContent=o,a.classList.remove(`meta-btn--success`,`meta-btn--danger`)},1500)}),r.addEventListener(`keydown`,e=>{e.ctrlKey&&e.key===`Enter`&&f()}),d()}document.addEventListener(`DOMContentLoaded`,()=>{e(`文本工具`),r()});