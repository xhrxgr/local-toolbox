import { injectToolHeader } from '/assets/js/common.js';
import { initEncoding } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('编码转换');
  initEncoding();
});
