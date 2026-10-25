import{t as e}from"./toast-C63kdhUO.js";import{o as t}from"./resource-registry-MGQVM-gY.js";var n=`resource-panel`,r=!1;function i(){if(r)return;r=!0;let e=document.createElement(`style`);e.textContent=`
    .${n} {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-secondary);
    }
    .${n} > summary {
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
    .${n} > summary::-webkit-details-marker { display: none; }
    .${n} > summary::before {
      content: '›';
      display: inline-block;
      transition: transform var(--transition-fast);
      color: var(--text-secondary);
    }
    .${n}[open] > summary::before { transform: rotate(90deg); }
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
    .resource-panel__link {
      color: var(--accent);
      text-decoration: none;
      margin: 0 2px;
    }
    .resource-panel__link:hover {
      text-decoration: underline;
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
  `,document.head.appendChild(e)}function a(e,r,a={}){let s=typeof e==`string`?document.querySelector(e):e;if(!s)return;i();let l=t(r);if(l.length===0)return;let u=document.createElement(`details`);u.className=n,a.collapsed||(u.open=!0),u.innerHTML=`
    <summary>
      <span>离线资源</span>
      <span class="resource-panel__badge" data-role="badge">检查中…</span>
    </summary>
    <div class="resource-panel__hint">大文件提前下载到本地，用的时候就不用等；删掉可释放空间。全部资源可在<a class="resource-panel__link" href="/local-toolbox/tools/resources/">资源中心</a>一次性下载。</div>
  `,s.innerHTML=``,s.appendChild(u);let d=document.createElement(`div`);d.className=`resource-panel__list`,u.appendChild(d);for(let e of l)d.appendChild(o(e,()=>c(u,l)));c(u,l)}function o(t,n){let r=document.createElement(`div`);r.className=`resource-item`;let i=document.createElement(`div`);i.className=`resource-item__main`,i.innerHTML=`
    <div class="resource-item__name">${t.name} · ${l(t.size)}</div>
    <div class="resource-item__desc">${t.desc}</div>
  `;let a=document.createElement(`span`);a.className=`resource-item__status`,a.textContent=`检查中…`;let o=document.createElement(`div`);o.className=`resource-item__actions`;let c=document.createElement(`button`);c.type=`button`,c.className=`btn btn-sm btn-primary`,c.textContent=`下载`;let u=document.createElement(`button`);u.type=`button`,u.className=`btn btn-sm btn--danger`,u.textContent=`删除`;let d=document.createElement(`div`);return d.className=`resource-item__progress`,d.hidden=!0,o.appendChild(c),o.appendChild(u),r.appendChild(i),r.appendChild(a),r.appendChild(o),r.appendChild(d),c.addEventListener(`click`,async()=>{c.disabled=!0,u.disabled=!0,c.textContent=`下载中…`,d.hidden=!1,d.textContent=`正在下载…`;try{await t.download((e,t)=>{if(!t){d.textContent=`已下载 ${l(e)}`;return}let n=Math.round(e/t*100);d.textContent=`下载中 ${n}%（${l(e)} / ${l(t)}）`}),d.textContent=`下载完成，已存到本地`,e(`${t.name} 下载完成`,`success`),await s(t,a,c,u),n?.()}catch(n){d.textContent=`下载失败：`+(n&&n.message?n.message:String(n)),e(`${t.name} 下载失败`,`error`),c.disabled=!1}finally{c.textContent=`下载`}}),u.addEventListener(`click`,async()=>{u.disabled=!0,c.disabled=!0,u.textContent=`删除中…`;try{await t.remove(),d.hidden=!0,e(`${t.name} 已删除`,`info`),await s(t,a,c,u),n?.()}catch{e(`${t.name} 删除失败`,`error`)}finally{u.textContent=`删除`}}),r}async function s(e,t,n,r){let i=!1;try{i=await e.isCached()}catch{i=!1}return t.textContent=i?`已在本地`:`未下载`,t.classList.toggle(`resource-item__status--ready`,i),n.disabled=i,r.disabled=!i,n.textContent=i?`已下载`:`下载`,i}async function c(e,t){let n=e.querySelectorAll(`.resource-item`),r=0;for(let e=0;e<t.length;e++){let i=n[e];i&&await s(t[e],i.querySelector(`.resource-item__status`),i.querySelector(`.resource-item__actions .btn-primary`),i.querySelector(`.resource-item__actions .btn--danger`))&&r++}let i=e.querySelector(`[data-role="badge"]`);i&&(i.textContent=r===t.length?`全部已就绪`:r>0?`${r}/${t.length} 已就绪`:`未下载`,i.classList.toggle(`resource-panel__badge--ready`,r===t.length&&t.length>0))}function l(e){return!e||Number.isNaN(e)?`—`:e<1024?e+` B`:e<1024*1024?(e/1024).toFixed(1)+` KB`:(e/1024/1024).toFixed(1)+` MB`}export{a as t};