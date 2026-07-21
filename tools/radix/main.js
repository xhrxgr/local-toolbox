import { injectToolHeader } from '/assets/js/common.js';
import { initRadix } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('进制转换');
  initRadix();
});
