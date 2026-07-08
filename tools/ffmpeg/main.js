import { injectToolHeader } from '/assets/js/common.js';
import { initFFmpeg } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('音视频转换');
  initFFmpeg();
});