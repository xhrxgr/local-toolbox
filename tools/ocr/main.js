import { injectToolHeader } from '/assets/js/common.js';
import { initOcr } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('OCR 图片识字');
  initOcr();
});
