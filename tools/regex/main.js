import { injectToolHeader } from '/assets/js/common.js';
import { initRegex } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('正则测试');
  initRegex();
});
