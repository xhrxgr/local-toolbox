import { injectToolHeader } from '/assets/js/common.js';
import { initImage } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('图片处理');
  initImage();
});
