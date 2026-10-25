import{t as e}from"./toast-C63kdhUO.js";var t=`resource-panel`,n=!1;function r(){if(n)return;n=!0;let e=document.createElement(`style`);e.textContent=`
    .${t} {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-secondary);
    }
    .${t} > summary {
      cursor: pointer;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--text);
      list-style: none;
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-height: 32px;
    }
    .${t} > summary::-webkit-details-marker { display: none; }
    .${t} > summary::before {
      content: '›';
      display: inline-block;
      transition: transform var(--transition-fast);
      color: var(--text-secondary);
    }
    .${t}[open] > summary::before { transform: rotate(90deg); }
    .resource-panel__badge {
      font-size: var(--text-xs);
      font-weight: 400;
      color: var(--text-secondary);
    }
    .resource-panel__badge--ready { color: #22c55e; }
    .resource-panel__hint {
      font-size: var(--text-xs);
      color: var(--text-secondary);
      line-height: 1.5;
    }
    .resource-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-sm);
      padding: var(--space-xs) 0;
      border-top: 1px dashed var(--border);
    }
    .resource-item:first-of-type { border-top: none; }
    .resource-item__main { flex: 1; min-width: 180px; }
    .resource-item__name { font-size: var(--text-sm); color: var(--text); }
    .resource-item__desc { font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.5; }
    .resource-item__status {
      font-size: var(--text-xs);
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .resource-item__status--ready { color: #22c55e; }
    .resource-item__actions { display: flex; gap: var(--space-xs); flex: none; }
    .resource-item__progress {
      width: 100%;
      font-size: var(--text-xs);
      color: var(--text-secondary);
    }
  `,document.head.appendChild(e)}function i(e,n,i={}){let o=typeof e==`string`?document.querySelector(e):e;if(!o)return;r();let c=document.createElement(`details`);c.className=t,i.collapsed||(c.open=!0),c.innerHTML=`
    <summary>
      <span>离线资源</span>
      <span class="resource-panel__badge" data-role="badge">检查中…</span>
    </summary>
    <div class="resource-panel__hint">大文件提前下载到本地，用的时候就不用等；删掉可释放空间。</div>
  `,o.innerHTML=``,o.appendChild(c);let l=document.createElement(`div`);l.className=`resource-panel__list`,c.appendChild(l);for(let e of n)l.appendChild(a(e,()=>s(c,n)));s(c,n)}function a(t,n){let r=document.createElement(`div`);r.className=`resource-item`;let i=document.createElement(`div`);i.className=`resource-item__main`,i.innerHTML=`
    <div class="resource-item__name">${t.name}${t.sizeLabel?` · `+t.sizeLabel:``}</div>
    <div class="resource-item__desc">${t.desc}</div>
  `;let a=document.createElement(`span`);a.className=`resource-item__status`,a.textContent=`检查中…`;let s=document.createElement(`div`);s.className=`resource-item__actions`;let c=document.createElement(`button`);c.type=`button`,c.className=`btn btn-sm btn-primary`,c.textContent=`下载`;let l=document.createElement(`button`);l.type=`button`,l.className=`btn btn-sm btn--danger`,l.textContent=`删除`;let d=document.createElement(`div`);return d.className=`resource-item__progress`,d.hidden=!0,s.appendChild(c),s.appendChild(l),r.appendChild(i),r.appendChild(a),r.appendChild(s),r.appendChild(d),c.addEventListener(`click`,async()=>{c.disabled=!0,l.disabled=!0,c.textContent=`下载中…`,d.hidden=!1,d.textContent=`正在下载…`;try{await t.download((e,t)=>{if(!t){d.textContent=`已下载 ${u(e)}`;return}let n=Math.round(e/t*100);d.textContent=`下载中 ${n}%（${u(e)} / ${u(t)}）`}),d.textContent=`下载完成，已存到本地`,e(`${t.name} 下载完成`,`success`),await o(t,a,c,l),n?.()}catch(n){d.textContent=`下载失败：`+(n&&n.message?n.message:String(n)),e(`${t.name} 下载失败`,`error`),c.disabled=!1}finally{c.textContent=`下载`}}),l.addEventListener(`click`,async()=>{l.disabled=!0,c.disabled=!0,l.textContent=`删除中…`;try{await t.remove(),d.hidden=!0,e(`${t.name} 已删除`,`info`),await o(t,a,c,l),n?.()}catch{e(`${t.name} 删除失败`,`error`)}finally{l.textContent=`删除`}}),r}async function o(e,t,n,r){let i=!1;try{i=await e.isCached()}catch{i=!1}return t.textContent=i?`已在本地`:`未下载`,t.classList.toggle(`resource-item__status--ready`,i),n.disabled=i,r.disabled=!i,n.textContent=i?`已下载`:`下载`,i}async function s(e,t){let n=e.querySelectorAll(`.resource-item`),r=0;for(let e=0;e<t.length;e++){let i=n[e];i&&await o(t[e],i.querySelector(`.resource-item__status`),i.querySelector(`.resource-item__actions .btn-primary`),i.querySelector(`.resource-item__actions .btn--danger`))&&r++}let i=e.querySelector(`[data-role="badge"]`);i&&(i.textContent=r===t.length?`全部已就绪`:r>0?`${r}/${t.length} 已就绪`:`未下载`,i.classList.toggle(`resource-panel__badge--ready`,r===t.length&&t.length>0))}async function c(e){if(!(`caches`in window))return!1;for(let t of await caches.keys()){let n=await caches.open(t);try{if(await n.match(e))return!0}catch{}}return!1}async function l(e){if(`caches`in window)for(let t of await caches.keys()){let n=await caches.open(t);try{await n.delete(e)}catch{}}}function u(e){return!e||Number.isNaN(e)?`—`:e<1024?e+` B`:e<1024*1024?(e/1024).toFixed(1)+` KB`:(e/1024/1024).toFixed(1)+` MB`}export{l as n,c as r,i as t};