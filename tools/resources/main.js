import { injectToolHeader } from '/assets/js/common.js';
import { initResources } from './app.js';
import { mountCacheSection } from '/assets/js/cache-manager.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('资源与缓存');
  // 本页就是资源与缓存入口，头部的入口按钮指向自己没有意义
  document.querySelector('.cache-manage-btn')?.remove();
  initResources();
  mountCacheSection('#cache-section');
});
