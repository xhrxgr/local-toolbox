import { injectToolHeader } from '/assets/js/common.js';
import { initHash } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('UUID/哈希');
  initHash();
});
