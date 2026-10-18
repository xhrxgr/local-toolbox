/**
 * 文档转换工具：各 Tab 处理模块的动态加载表
 * 按需 import，首屏只加载主入口，点击哪个 Tab 才加载哪个库
 */
export const TAB_MODULE_LOADERS = {
  pdf:    () => import('./handlers/pdf.js'),
  word:   () => import('./handlers/word.js'),
  excel:  () => import('./handlers/excel.js'),
  mdhtml: () => import('./handlers/mdhtml.js'),
  rtf:    () => import('./handlers/rtf.js'),
  epub:   () => import('./handlers/epub.js'),
};
