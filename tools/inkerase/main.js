import { injectToolHeader } from '/assets/js/common.js';
import { initInkErase } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('笔迹消除');
  initInkErase();
});