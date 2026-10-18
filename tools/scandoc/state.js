/**
 * 扫描文档：页面集合状态管理
 * 每页结构：
 *   { id, name, img: HTMLImageElement, filter: 'original'|'bw'|'enhance',
 *     rotation: 0|90|180|270, corners: [{x,y}×4]|null（相对坐标，TL/TR/BR/BL 序）,
 *     cornersDetected: bool, thumb: dataURL }
 */
let pages = [];
let selectedId = null;
let idSeed = 0;

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach(fn => fn());
}

export function getPages() {
  return pages;
}

export function getSelected() {
  return pages.find(p => p.id === selectedId) || null;
}

export function selectPage(id) {
  if (selectedId === id) return;
  selectedId = id;
  emit();
}

/** 导入图片文件 → 解码为页面，返回新增的页面（按导入时间追加到末尾） */
export async function addImageFiles(files) {
  const added = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const img = await loadImage(file);
      pages.push({
        id: `p${Date.now().toString(36)}_${idSeed++}`,
        name: file.name || `图片 ${pages.length + 1}`,
        img,
        filter: 'original',
        rotation: 0,
        corners: null,
        cornersDetected: false,
        thumb: null,
      });
      added.push(pages[pages.length - 1]);
    } catch {
      // 单张解码失败跳过
    }
  }
  if (added.length > 0 && !selectedId) {
    selectedId = added[0].id;
  }
  emit();
  return added;
}

export function removePage(id) {
  const idx = pages.findIndex(p => p.id === id);
  if (idx < 0) return;
  pages.splice(idx, 1);
  if (selectedId === id) {
    selectedId = pages.length > 0 ? pages[Math.min(idx, pages.length - 1)].id : null;
  }
  emit();
}

/** 拖拽排序：把 from 索引的页移到 to 索引 */
export function movePage(from, to) {
  if (from === to || from < 0 || from >= pages.length || to < 0 || to >= pages.length) return;
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  emit();
}

export function updatePage(id, patch) {
  const page = pages.find(p => p.id === id);
  if (!page) return;
  Object.assign(page, patch);
  emit();
}

export function clearPages() {
  pages = [];
  selectedId = null;
  emit();
}

export function nextId() {
  return `p${Date.now().toString(36)}_${idSeed++}`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // 保留 url 以便后续绘制？不需要——绘制完即可释放
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法解码图片: ' + file.name));
    };
    img.src = url;
  });
}
