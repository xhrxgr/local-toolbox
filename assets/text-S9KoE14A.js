import{t as e}from"./common-fvDkMcza.js";function t(){let e=e=>document.getElementById(e),t=e(`text-input`),n=e(`text-output`),r=e(`text-op`),i=e(`text-stats`),a=e(`replace-options`),o=e(`prefix-options`),s=e(`suffix-options`),c=e(`text-meta`);function l(){let t=r.value;a.hidden=!(t===`replace`||t===`replace-regex`),o.hidden=t!==`add-prefix`,s.hidden=t!==`add-suffix`,e(`replace-ci-wrap`).hidden=t!==`replace`,i.hidden=!0}r.addEventListener(`change`,l);function u(){let i=t.value,a=r.value,o=``,s=``;try{switch(a){case`stats`:d(i),n.value=``;return;case`upper`:o=i.toUpperCase();break;case`lower`:o=i.toLowerCase();break;case`title`:o=i.replace(/\b\w/g,e=>e.toUpperCase());break;case`sentence`:o=i.replace(/(^\s*|[.!?。！？]\s+)([a-z\u4e00-\u9fa5])/g,(e,t,n)=>t+n.toUpperCase());break;case`camel`:o=i.split(/[\s_-]+/).filter(Boolean).map((e,t)=>t===0?e.toLowerCase():e.charAt(0).toUpperCase()+e.slice(1).toLowerCase()).join(``);break;case`snake`:o=i.trim().split(/[\s-]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`_`);break;case`kebab`:o=i.trim().split(/[\s_]+/).filter(Boolean).map(e=>e.toLowerCase()).join(`-`);break;case`dedup-line`:o=f(i,!1);break;case`dedup-line-sort`:o=f(i,!0);break;case`sort-asc`:o=i.split(`
`).sort((e,t)=>e.localeCompare(t)).join(`
`);break;case`sort-desc`:o=i.split(`
`).sort((e,t)=>t.localeCompare(e)).join(`
`);break;case`sort-len`:o=i.split(`
`).sort((e,t)=>e.length-t.length).join(`
`);break;case`reverse-line`:o=i.split(`
`).map(e=>[...e].reverse().join(``)).join(`
`);break;case`reverse-all`:o=[...i].reverse().join(``);break;case`reverse-line-order`:o=i.split(`
`).reverse().join(`
`);break;case`remove-empty`:o=i.split(`
`).filter(e=>e.trim()!==``).join(`
`);break;case`trim-line`:o=i.split(`
`).map(e=>e.trim()).join(`
`);break;case`tab-to-space`:o=i.replace(/\t/g,`    `);break;case`space-to-tab`:o=i.replace(/    /g,`	`);break;case`replace`:{let t=e(`replace-from`).value,n=e(`replace-to`).value,r=e(`replace-global`).checked,a=e(`replace-ci`).checked;if(!t){o=i;break}let c=(r?`g`:``)+(a?`i`:``),l=new RegExp(p(t),c);o=i.replace(l,n),s=`替换了 ${(i.match(new RegExp(p(t),`g`+(a?`i`:``)))||[]).length} 处`;break}case`replace-regex`:{let t=e(`replace-from`).value,n=e(`replace-to`).value,r=e(`replace-global`).checked;if(!t){o=i;break}let a=r?`g`:``,c=t.match(/^\/(.+)\/([gimsuy]*)$/),l;try{l=c?new RegExp(c[1],c[2]+(r&&!c[2].includes(`g`)?`g`:``)):new RegExp(t,a)}catch(e){s=`正则错误：`+e.message,o=i;break}o=i.replace(l,n),s=`替换了 ${(i.match(l.global?l:new RegExp(l.source,l.flags+`g`))||[]).length} 处`;break}case`add-prefix`:{let t=e(`prefix-text`).value;o=i.split(`
`).map(e=>t+e).join(`
`);break}case`add-suffix`:{let t=e(`suffix-text`).value;o=i.split(`
`).map(e=>e+t).join(`
`);break}case`add-line-num`:{let e=i.split(`
`),t=String(e.length).length;o=e.map((e,n)=>`${String(n+1).padStart(t,`0`)}  ${e}`).join(`
`);break}case`remove-duplicate-chars`:o=i.replace(/(.)\1+/g,`$1`);break;default:o=i}}catch(e){s=`错误：`+e.message,o=i}n.value=o,c.textContent=s}function d(t){let n=t.split(`
`),r=n.filter(e=>e.trim()!==``).length,a=t.length,o=t.replace(/\s/g,``).length,s=(t.match(/[a-zA-Z0-9_]+/g)||[]).length+(t.match(/[\u4e00-\u9fa5]/g)||[]).length,l=new TextEncoder().encode(t).length;e(`stat-chars`).textContent=a,e(`stat-chars-nospace`).textContent=o,e(`stat-words`).textContent=s,e(`stat-lines`).textContent=n.length,e(`stat-nonempty`).textContent=r,e(`stat-bytes`).textContent=l,i.hidden=!1,c.textContent=`共 ${n.length} 行 / ${s} 词 / ${a} 字符 / ${l} 字节`}function f(e,t){let n=new Set,r=[];for(let t of e.split(`
`))n.has(t)||(n.add(t),r.push(t));return t&&r.sort((e,t)=>e.localeCompare(t)),r.join(`
`)}function p(e){return e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`)}e(`btn-run`).addEventListener(`click`,u),e(`btn-swap`).addEventListener(`click`,()=>{n.value&&(t.value=n.value,n.value=``,c.textContent=`已用结果替换输入`)}),e(`btn-clear`).addEventListener(`click`,()=>{t.value=``,n.value=``,i.hidden=!0,c.textContent=``}),e(`btn-copy`).addEventListener(`click`,()=>{n.value&&navigator.clipboard.writeText(n.value).then(()=>{let t=e(`btn-copy`),n=t.textContent;t.textContent=`已复制`,setTimeout(()=>{t.textContent=n},1500)}).catch(()=>alert(`复制失败，请手动选择`))}),t.addEventListener(`keydown`,e=>{e.ctrlKey&&e.key===`Enter`&&u()}),l()}document.addEventListener(`DOMContentLoaded`,()=>{e(`文本工具`),t()});