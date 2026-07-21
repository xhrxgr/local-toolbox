import { injectToolHeader } from '/assets/js/common.js';
import { initSvg } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('SVG 优化器');
  initSvg();
});
