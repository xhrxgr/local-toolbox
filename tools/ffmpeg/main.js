import { injectToolHeader } from '/assets/js/common.js';
import { initFFmpeg } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('多媒体转换');
  initFFmpeg();
});