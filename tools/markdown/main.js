import { injectToolHeader } from '/assets/js/common.js';
import { initMarkdown } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  injectToolHeader('Markdown 预览');
  initMarkdown();
});
