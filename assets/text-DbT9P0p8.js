import{t as e}from"./common-B_oMvnZx.js";import{t}from"./clipboard-D9I1EFhj.js";function n(){let e=e=>document.getElementById(e),n=e(`text-input`),r=e(`text-output`),i=e(`text-op`),a=e(`text-stats`),o=e(`replace-options`),s=e(`prefix-options`),c=e(`suffix-options`),l=e(`text-meta`);function u(){let t=i.value;o.hidden=!(t===`replace`||t===`replace-regex`),s.hidden=t!==`add-prefix`,c.hidden=t!==`add-suffix`,e(`replace-ci-wrap`).hidden=t!==`replace`,a.hidden=!0}i.addEventListener(`change`,u);function d(){let t=n.value,a=i.value,o=``,s=``;try{switch(a){case`stats`:f(t),r.value=``;return;case`upper`:o=t.toUpperCase();break;case`lower`:o=t.toLowerCase();break;case`title`:o=t.replace(/\b\w/g,e=>e.toUpperCase());break;case`sentence`:o=t.replace(/(^\s*|[.!?。！？]\s+)([a-z\u4e00-\u9fa5])/g,(e,t,n)=>t+n.toUpperCase());break;case`camel`:o=t.split(/[\s_-]+/).filter(Boolean).map((e,t)=>t===0?e.toLowerCase():e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join(``);break;case`snake`:o=t.trim().split(/[\s-]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`_`);break;case`kebab`:o=t.trim().split(/[\s_]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`-`);break;case`dedup-line`:o=p(t,!1);break;case`dedup-line-sort`:o=p(t,!0);break;case`sort-asc`:o=t.split(`
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
`);break;case`tab-to-space`:o=t.replace(/\t/g,`    `);break;case`space-to-tab`:o=t.replace(/    /g,`	`);break;case`replace`:{let n=e(`replace-from`).value,r=e(`replace-to`).value,i=e(`replace-global`).checked,a=e(`replace-ci`).checked;if(!n){o=t;break}let c=(i?`g`:``)+(a?`i`:``),l=new RegExp(m(n),c);o=t.replace(l,r),s=`替换了 ${(t.match(new RegExp(m(n),`g`+(a?`i`:``)))||[]).length} 处`;break}case`replace-regex`:{let n=e(`replace-from`).value,r=e(`replace-to`).value,i=e(`replace-global`).checked;if(!n){o=t;break}let a=i?`g`:``,c=n.match(/^\/(.+)\/([gimsuy]*)$/),l;try{l=c?new RegExp(c[1],c[2]+(i&&!c[2].includes(`g`)?`g`:``)):new RegExp(n,a)}catch(e){s=`正则错误：`+e.message,o=t;break}o=t.replace(l,r),s=`替换了 ${(t.match(l.global?l:new RegExp(l.source,l.flags+`g`))||[]).length} 处`;break}case`add-prefix`:{let n=e(`prefix-text`).value;o=t.split(`
`).map(e=>n+e).join(`
`);break}case`add-suffix`:{let n=e(`suffix-text`).value;o=t.split(`
`).map(e=>e+n).join(`
`);break}case`add-line-num`:{let e=t.split(`
`),n=String(e.length).length;o=e.map((e,t)=>`${String(t+1).padStart(n,`0`)}  ${e}`).join(`
`);break}case`remove-duplicate-chars`:o=t.replace(/(.)\1+/g,`$1`);break;default:o=t}}catch(e){s=`错误：`+e.message,o=t}r.value=o,l.textContent=s}function f(t){let n=t.split(`
`),r=n.filter(e=>e.trim()!==``).length,i=t.length,o=t.replace(/\s/g,``).length,s=(t.match(/[a-zA-Z0-9_]+/g)||[]).length+(t.match(/[\u4e00-\u9fa5]/g)||[]).length,c=new TextEncoder().encode(t).length;e(`stat-chars`).textContent=i,e(`stat-chars-nospace`).textContent=o,e(`stat-words`).textContent=s,e(`stat-lines`).textContent=n.length,e(`stat-nonempty`).textContent=r,e(`stat-bytes`).textContent=c,a.hidden=!1,l.textContent=`共 ${n.length} 行 / ${s} 词 / ${i} 字符 / ${c} 字节`}function p(e,t){let n=new Set,r=[];for(let t of e.split(`
`))n.has(t)||(n.add(t),r.push(t));return t&&r.sort((e,t)=>e.localeCompare(t)),r.join(`
`)}function m(e){return e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`)}e(`btn-run`).addEventListener(`click`,d),e(`btn-swap`).addEventListener(`click`,()=>{r.value&&(n.value=r.value,r.value=``,l.textContent=`已用结果替换输入`)}),e(`btn-clear`).addEventListener(`click`,()=>{n.value=``,r.value=``,a.hidden=!0,l.textContent=``}),e(`btn-copy`).addEventListener(`click`,async()=>{if(!r.value)return;let n=await t(r.value),i=e(`btn-copy`),a=i.textContent;i.textContent=n?`已复制`:`复制失败`,i.classList.add(n?`meta-btn--success`:`meta-btn--danger`),setTimeout(()=>{i.textContent=a,i.classList.remove(`meta-btn--success`,`meta-btn--danger`)},1500)}),n.addEventListener(`keydown`,e=>{e.ctrlKey&&e.key===`Enter`&&d()}),u()}document.addEventListener(`DOMContentLoaded`,()=>{e(`文本工具`),n()});