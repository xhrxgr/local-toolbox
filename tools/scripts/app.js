/**
 * 实用脚本下载
 *
 * 仓库 scripts/ 下的 Windows 批处理脚本通过 ?url 导入作为静态资源，
 * 由 Vite 打进产物（带 hash 便于缓存），页面提供下载入口。
 * 脚本本身不联网、不上传任何数据。
 *
 * 页面交互：
 * - 顶部搜索框按名称/描述/用途/文件名过滤，命中处高亮；
 * - 卡片用紧凑的单行列表布局，一条脚本占一行，纵向空间省得多。
 */
import hotspotUrl from '../../scripts/hotspot-max-connections.bat?url';
import toggleClockUrl from '../../scripts/toggle-clock-seconds.bat?url';
import autostartUrl from '../../scripts/hotspot-autostart.bat?url';
import { escapeHtml, highlightMatches } from '/assets/js/text-match.js';

const SCRIPTS = [
  {
    id: 'hotspot-autostart',
    name: '移动热点开机自启',
    file: 'hotspot-autostart.bat',
    url: autostartUrl,
    os: 'Windows 10 / 11',
    admin: true,
    desc: '开机后自动打开 Windows 设置里的「移动热点」，不用每次手动开。走系统自带的移动热点接口，设置页里的开关状态会同步变化。',
    points: ['单个 .bat 文件，下载后双击即用，不用解压、不用管其它文件', '菜单式操作：安装 / 卸载 / 立即开关 / 查看状态', '卸载时可选择连程序文件一起删，完全还原到安装前', '开机时网络未就绪会自动等待重试（最多 180 秒）'],
  },
  {
    id: 'hotspot',
    name: '移动热点连接数上限',
    file: 'hotspot-max-connections.bat',
    url: hotspotUrl,
    os: 'Windows 10 / 11',
    admin: true,
    desc: 'Windows 移动热点默认最多连 8 台设备，这个脚本可把上限改到 1-100（菜单式操作，可随时恢复默认）。',
    points: ['菜单式操作：修改 / 恢复原始值 / 查看当前值', '首次运行备份原始设置，恢复时按备份还原（而非一律回到默认）', '修改后重开热点或重启电脑生效'],
  },
  {
    id: 'clock',
    name: '任务栏时钟显示秒数',
    file: 'toggle-clock-seconds.bat',
    url: toggleClockUrl,
    os: 'Windows 10 / 11',
    admin: false,
    desc: 'Windows 任务栏时钟默认不显示秒数，这个脚本一键切换显示/隐藏，无需进系统设置。',
    points: ['再运行一次即可切回', '自动重启资源管理器使设置生效', '不需要管理员权限'],
  },
];

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

/* 取文件大小：走一次 fetch，顺带把脚本预热进浏览器缓存 */
async function loadSize(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const buf = await resp.arrayBuffer();
    return formatSize(buf.byteLength);
  } catch {
    return '';
  }
}

/* ---------- 搜索 ---------- */

/* 把查询串拆成词：按空白切分，各词之间是「与」关系 */
function parseQuery(raw) {
  return String(raw || '')
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

/* 命中文本里是否包含全部关键词 */
function matchesWords(haystack, words) {
  const lower = haystack.toLowerCase();
  return words.every((w) => lower.includes(w));
}

/* 一个脚本的可搜索文本：名称 + 描述 + 用途 + 文件名 */
function searchableText(script) {
  return [script.name, script.desc, script.file, ...(script.points || [])].join(' ');
}

/* ---------- 渲染 ---------- */

/*
 * 紧凑布局：一条脚本占一行。
 * 左列是名称与描述，右列是标签与操作按钮。
 * 描述里的命中词用 <mark> 高亮 —— 文本先经 escapeHtml 转义再拼进模板。
 */
function renderScript(script, words, sizeCache) {
  const card = document.createElement('article');
  card.className = 'script-card';

  const main = document.createElement('div');
  main.className = 'script-card__main';

  const title = document.createElement('h3');
  title.className = 'script-card__title';
  title.innerHTML = highlightMatches(script.name, words);
  main.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'script-card__desc';
  desc.innerHTML = highlightMatches(script.desc, words);
  // 单行截断后看不到全文，悬停提示补上
  desc.title = script.desc;
  main.appendChild(desc);

  // 用途要点收进 details，默认折叠 —— 展开才占地方
  if (script.points && script.points.length) {
    const details = document.createElement('details');
    details.className = 'script-card__points';

    const summary = document.createElement('summary');
    summary.className = 'script-card__points-summary';
    summary.textContent = '用途';
    details.appendChild(summary);

    const ul = document.createElement('ul');
    for (const p of script.points) {
      const li = document.createElement('li');
      li.innerHTML = highlightMatches(p, words);
      ul.appendChild(li);
    }
    details.appendChild(ul);
    main.appendChild(details);
  }

  const side = document.createElement('div');
  side.className = 'script-card__side';

  const tags = document.createElement('div');
  tags.className = 'script-card__tags';
  const osTag = document.createElement('span');
  osTag.className = 'script-card__tag';
  osTag.textContent = script.os;
  tags.appendChild(osTag);
  if (script.admin) {
    const adminTag = document.createElement('span');
    adminTag.className = 'script-card__tag script-card__tag--warn';
    adminTag.textContent = '需管理员';
    tags.appendChild(adminTag);
  }
  const sizeTag = document.createElement('span');
  sizeTag.className = 'script-card__tag';
  sizeTag.dataset.sizeFor = script.id;
  sizeTag.textContent = (sizeCache && sizeCache.get(script.id)) || '—';
  tags.appendChild(sizeTag);
  side.appendChild(tags);

  const actions = document.createElement('div');
  actions.className = 'script-card__actions';
  const link = document.createElement('a');
  link.className = 'btn btn-primary';
  link.href = script.url;
  link.download = script.file;
  link.textContent = '下载';
  actions.appendChild(link);
  const fileLink = document.createElement('a');
  fileLink.className = 'script-card__file';
  fileLink.href = script.url;
  fileLink.target = '_blank';
  fileLink.rel = 'noopener';
  fileLink.textContent = '查看内容';
  actions.appendChild(fileLink);
  side.appendChild(actions);

  card.appendChild(main);
  card.appendChild(side);
  return card;
}

function renderEmpty(query) {
  const box = document.createElement('div');
  box.className = 'script-empty';
  const text = document.createElement('p');
  text.className = 'script-empty__text';
  text.innerHTML = '未找到匹配「' + escapeHtml(query) + '」的脚本';
  box.appendChild(text);
  const hint = document.createElement('p');
  hint.className = 'script-empty__hint';
  hint.textContent = '换个关键词试试，或清空搜索框查看全部脚本';
  box.appendChild(hint);
  return box;
}

function initScripts() {
  const list = document.getElementById('script-list');
  const search = document.getElementById('script-search');
  const count = document.getElementById('script-count');
  if (!list) return;

  /* 文件大小缓存：
     每次搜索都会重建卡片，若不缓存，重建后 size 标签会回到「—」
     且不再更新（原来的 loadSize 回调绑在旧节点上）。 */
  const sizeCache = new Map();

  function apply(raw) {
    const words = parseQuery(raw);
    list.innerHTML = '';

    const hits = SCRIPTS.filter((s) => matchesWords(searchableText(s), words));
    for (const s of hits) {
      list.appendChild(renderScript(s, words, sizeCache));
    }
    if (!hits.length) {
      list.appendChild(renderEmpty(raw.trim()));
    }
    if (count) {
      count.textContent = words.length ? `${hits.length} / ${SCRIPTS.length}` : `${SCRIPTS.length} 个脚本`;
    }
  }

  if (search) {
    search.addEventListener('input', () => apply(search.value));
    // 回车不提交表单，避免页面刷新
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    // 快捷键：/ 聚焦搜索框，Esc 清空
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        search.focus();
        search.select();
      } else if (e.key === 'Escape' && document.activeElement === search) {
        search.value = '';
        apply('');
        search.blur();
      }
    });
  }

  apply('');

  // 取一次文件大小，顺带把脚本预热进浏览器缓存；结果写进缓存供重建时复用
  for (const script of SCRIPTS) {
    loadSize(script.url).then((size) => {
      if (!size) return;
      sizeCache.set(script.id, size);
      const tag = list.querySelector(`[data-size-for="${script.id}"]`);
      if (tag) tag.textContent = size;
    });
  }
}

export { initScripts };
