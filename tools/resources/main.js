import { injectToolHeader } from '/assets/js/common.js';
import { initResources } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('资源中心');
  initResources();
});
