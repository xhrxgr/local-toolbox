var e=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path></svg>`,t=null,n=null,r=null,i=new Set,a=null,o=null;function s(){if(document.getElementById(`cache-manage-style`))return;let e=document.createElement(`style`);e.id=`cache-manage-style`,e.textContent=`
    .cache-manage-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      min-height: 36px;
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .cache-manage-btn:hover { color: var(--accent); background: var(--card); }
    .cache-manage-btn svg { flex: none; }
    @media (max-width: 640px) {
      .cache-manage-btn { min-height: 40px; }
      .cache-manage-btn__text { display: none; }
    }
  `,document.head.appendChild(e)}function c(){if(t)return t;let e=document.createElement(`div`);return e.className=`cache-panel`,e.id=`cache-panel`,e.hidden=!0,e.innerHTML=`
    <div class="cache-panel__mask" data-cache-close></div>
    <div class="cache-panel__box" role="dialog" aria-modal="true" aria-label="本地缓存管理">
      <div class="cache-panel__head">
        <h2>本地缓存管理</h2>
        <button class="cache-panel__close" type="button" data-cache-close aria-label="关闭"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
      </div>
      <div class="cache-panel__summary" id="cache-summary">读取中…</div>
      <div class="cache-panel__actions">
        <button class="btn btn-sm btn-secondary" type="button" id="cache-refresh">刷新</button>
        <button class="btn btn-sm btn-secondary" type="button" id="cache-persist">保持持久化</button>
        <button class="btn btn-sm btn--danger" type="button" id="cache-clear-all">清除全部缓存</button>
      </div>
      <div class="cache-panel__list" id="cache-list"></div>
      <div class="cache-panel__note">
        缓存用于加速二次访问：页面文件走网络优先（保证内容最新），静态资源与 CDN
        内核命中缓存后不再联网。删除后下次访问相应内容会自动重新下载；
        「清除全部缓存」不会删除任何个人数据。存储占用为本站整体用量
        （含缓存与其他站点数据）。
      </div>
    </div>
  `,document.body.appendChild(e),t=e,n=e.querySelector(`#cache-list`),r=e.querySelector(`#cache-summary`),e.addEventListener(`click`,e=>{e.target.closest(`[data-cache-close]`)&&u()}),e.querySelector(`#cache-refresh`).addEventListener(`click`,()=>p()),e.querySelector(`#cache-persist`).addEventListener(`click`,x),e.querySelector(`#cache-clear-all`).addEventListener(`click`,b),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&!t.hidden&&u()}),t}function l(){c(),a=document.activeElement,t.hidden=!1,p(),t.querySelector(`.cache-panel__box`).focus()}function u(){t&&(o&&o(),t.hidden=!0,a&&a.isConnected&&a.focus())}function d(e){return e==null||Number.isNaN(e)?`—`:e<1024?e+` B`:e<1024*1024?(e/1024).toFixed(1)+` KB`:(e/1024/1024).toFixed(2)+` MB`}async function f(e,t){try{let n=await e.match(t);if(!n)return null;let r=n.headers.get(`content-length`);return r===null?(await n.clone().arrayBuffer()).byteLength:parseInt(r,10)}catch{return null}}async function p(){if(!n)return;n.innerHTML=`<div class="cache-empty">读取中…</div>`;let e=[];try{e=await caches.keys()}catch{e=[]}let t=`存储用量不可用`;try{if(navigator.storage&&navigator.storage.estimate){let e=await navigator.storage.estimate();t=`已用 ${d(e.usage)} / 配额 ${d(e.quota)}`}}catch{}let r=null;try{navigator.storage&&navigator.storage.persisted&&(r=await navigator.storage.persisted())}catch{}let i=0,a=0,o=[];for(let t of e){let e;try{e=await caches.open(t)}catch{continue}let n=await e.keys(),r=0,s=[];for(let t of n){let n=await f(e,t);n!==null&&(r+=n),s.push({req:t,size:n})}i+=s.length,a+=r,o.push({name:t,cache:e,items:s,bytes:r})}m({estimateText:t,persisted:r,totalEntries:i,cacheCount:o.length,totalBytes:a});try{h(o)}catch(e){n.innerHTML=``;let t=document.createElement(`div`);t.className=`cache-empty`,t.textContent=`列表渲染失败：`+(e&&e.message?e.message:String(e)),n.appendChild(t)}}function m({estimateText:e,persisted:t,totalEntries:n,cacheCount:i,totalBytes:a}){let o=r.parentElement.querySelector(`#cache-persist`),s=t===!0?`已开启`:t===!1?`未开启`:`不可用`;r.innerHTML=`
    <span>${C(e)}</span>
    <span>存储持久化：${s}</span>
    <span>缓存 ${i} 个 · 条目 ${n} 条 · 合计 ${d(a)}</span>
  `,o&&!o.dataset.flashing&&(o.disabled=!1,o.textContent=t===!0?`持久化已开启`:`保持持久化`,o.title=t===!0?`已开启：浏览器不会自动清理本站缓存，点击可查看状态`:`防止浏览器在磁盘空间不足时自动清理本站缓存`)}function h(e){if(e.length===0){n.innerHTML=`<div class="cache-empty">暂无缓存。访问过的页面与用过的功能会自动缓存，下次访问即可离线可用。</div>`;return}n.innerHTML=``;for(let t of e)n.appendChild(g(t))}function g(e){let t=document.createElement(`div`);t.className=`cache-group`;let n=document.createElement(`div`);n.className=`cache-group__head`,n.innerHTML=`
    <span class="cache-group__name">${C(e.name)}</span>
    <span class="cache-group__meta">${e.items.length} 条 · ${d(e.bytes)}</span>
    <button class="btn btn-sm btn--danger cache-group__clear" type="button">清空此缓存</button>
  `,n.querySelector(`.cache-group__clear`).addEventListener(`click`,t=>{let n=t.currentTarget;v(n,`确认清空？`,async()=>{n.disabled=!0,n.textContent=`清理中…`;try{await caches.delete(e.name),S(n,`已清空`,`btn--success`)}catch{S(n,`清空失败`,`btn--danger`)}p()})}),t.appendChild(n);let r=i.has(e.name)?e.items.length:60,a=e.items.slice(0,r),o=document.createElement(`div`);o.className=`cache-group__list`;for(let t of a)o.appendChild(_(e,t));if(t.appendChild(o),e.items.length>60&&!i.has(e.name)){let n=document.createElement(`button`);n.className=`cache-group__more`,n.type=`button`,n.textContent=`展开其余 ${e.items.length-60} 条`,n.addEventListener(`click`,()=>{i.add(e.name),p()}),t.appendChild(n)}return t}function _(e,t){let n=document.createElement(`div`);n.className=`cache-item`;let r;try{let e=new URL(t.req.url);r=e.origin===location.origin?e.pathname+e.search:e.host+e.pathname}catch{r=t.req.url}let i=document.createElement(`span`);i.className=`cache-item__url`,i.textContent=r,i.title=t.req.url;let a=document.createElement(`span`);a.className=`cache-item__size`,a.textContent=d(t.size);let o=document.createElement(`button`);return o.className=`btn btn-sm btn--danger cache-item__del`,o.type=`button`,o.textContent=`删除`,o.addEventListener(`click`,async()=>{o.disabled=!0,o.textContent=`删除中…`;try{await e.cache.delete(t.req),S(o,`已删除`,`btn--success`)}catch{S(o,`失败`,`btn--danger`)}p()}),n.appendChild(i),n.appendChild(a),n.appendChild(o),n}function v(e,t,n){if(e.dataset.armed)return;e.dataset.armed=`1`;let r=e.textContent;e.textContent=t,e.classList.add(`btn--danger`),e.title=`再次点击确认执行`;let i=document.createElement(`button`);i.type=`button`,i.className=`btn btn-sm btn-secondary`,i.textContent=`取消`,e.parentElement.insertBefore(i,e.nextSibling);let a=setTimeout(s,5e3);function s(){clearTimeout(a),delete e.dataset.armed,e.textContent=r,e.classList.remove(`btn--danger`),e.title=``,i.remove(),e.removeEventListener(`click`,c,!0),o===s&&(o=null)}function c(e){e.stopImmediatePropagation(),s(),n()}i.addEventListener(`click`,s),e.addEventListener(`click`,c,!0),o=s}function y(){let e=r.parentElement.querySelector(`#cache-clear-all`);e.disabled=!0,e.textContent=`清理中…`,caches.keys().then(e=>Promise.all(e.map(e=>caches.delete(e)))).then(()=>{i=new Set,p(),S(e,`已清除全部`,`btn--success`)}).catch(()=>{S(e,`清除失败`,`btn--danger`)})}function b(){v(r.parentElement.querySelector(`#cache-clear-all`),`确认清除全部？`,y)}async function x(){let e=r.parentElement.querySelector(`#cache-persist`);try{let t=await navigator.storage.persist();S(e,t?`已开启，无需重复申请`:`未获授权`,t?`btn--success`:`btn--danger`,p)}catch{S(e,`不可用`,`btn--danger`,p)}}function S(e,t,n,r){if(e.dataset.flashing)return;let i=e.textContent;e.textContent=t,e.classList.add(n),e.dataset.flashing=`1`,setTimeout(()=>{e.textContent=i,e.classList.remove(n),delete e.dataset.flashing,e.disabled=!1,r&&r()},1500)}function C(e){return String(e).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e])}s(),c(),document.addEventListener(`click`,e=>{e.target.closest(`.cache-manage-btn`)&&l()});export{e as ICON_DB};