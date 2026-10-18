import { injectToolHeader } from '/assets/js/common.js';
import { initScanDoc } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('扫描文档');
  initScanDoc();
});
