import { injectToolHeader } from '/assets/js/common.js';
import { initColor } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('颜色工具');
  initColor();
});
