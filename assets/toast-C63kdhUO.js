var e={info:2600,success:2600,warning:3600,error:4800},t=`sw-toast-container`,n=`sw-toast-style`,r=`
.${t} {
  position: fixed;
  bottom: var(--space-lg);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  z-index: 2000;
  pointer-events: none;
}
.sw-toast {
  max-width: min(480px, calc(100vw - 2 * var(--space-lg)));
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  text-align: center;
  box-shadow: var(--shadow-lg);
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  border: 1px solid transparent;
  word-break: break-all;
}
.sw-toast--visible { opacity: 1; transform: translateY(0); }
.sw-toast--info { background: var(--card); color: var(--text); border-color: var(--border); }
.sw-toast--success { background: #ecfdf5; color: #065f46; border-color: #6ee7b7; }
.sw-toast--warning { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
.sw-toast--error { background: #fef2f2; color: #b91c1c; border-color: #fca5a5; }
[data-theme="dark"] .sw-toast--success { background: #022c22; color: #6ee7b7; border-color: #065f46; }
[data-theme="dark"] .sw-toast--warning { background: #422006; color: #fde68a; border-color: #78350f; }
[data-theme="dark"] .sw-toast--error { background: #450a0a; color: #fca5a5; border-color: #7f1d1d; }
`;function i(){let e=document.getElementById(t);if(e)return e;if(!document.getElementById(n)){let e=document.createElement(`style`);e.id=n,e.textContent=r,document.head.appendChild(e)}return e=document.createElement(`div`),e.id=t,e.className=t,e.setAttribute(`aria-live`,`polite`),document.body.appendChild(e),e}function a(t,n=`info`,r){let a=i(),o=document.createElement(`div`);o.className=`sw-toast sw-toast--${n}`,o.textContent=t,a.appendChild(o),requestAnimationFrame(()=>o.classList.add(`sw-toast--visible`)),setTimeout(()=>{o.classList.remove(`sw-toast--visible`),setTimeout(()=>o.remove(),300)},r??e[n]??2600)}export{a as t};