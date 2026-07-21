import { injectToolHeader } from '/assets/js/common.js';
import { initDocument } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('文档转换');
  initDocument();
});
