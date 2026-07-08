import { injectToolHeader } from '/assets/js/common.js';
import { initNetwork } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('网络工具');
  initNetwork();
});
