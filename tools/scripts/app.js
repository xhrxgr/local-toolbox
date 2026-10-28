/**
 * 实用脚本下载
 *
 * 仓库 scripts/ 下的 Windows 批处理脚本通过 ?url 导入作为静态资源，
 * 由 Vite 打进产物（带 hash 便于缓存），页面提供下载入口。
 * 脚本本身不联网、不上传任何数据。
 */
import hotspotUrl from '../../scripts/hotspot-max-connections.bat?url';
import toggleClockUrl from '../../scripts/toggle-clock-seconds.bat?url';
import autostartUrl from '../../scripts/hotspot-autostart.bat?url';

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

function renderScript(script) {
  const card = document.createElement('article');
  card.className = 'script-card';

  const head = document.createElement('div');
  head.className = 'script-card__head';

  const title = document.createElement('h3');
  title.className = 'script-card__title';
  title.textContent = script.name;
  head.appendChild(title);

  const tags = document.createElement('div');
  tags.className = 'script-card__tags';
  const osTag = document.createElement('span');
  osTag.className = 'script-card__tag';
  osTag.textContent = script.os;
  tags.appendChild(osTag);
  if (script.admin) {
    const adminTag = document.createElement('span');
    adminTag.className = 'script-card__tag script-card__tag--warn';
    adminTag.textContent = '需管理员权限';
    tags.appendChild(adminTag);
  }
  const sizeTag = document.createElement('span');
  sizeTag.className = 'script-card__tag';
  sizeTag.dataset.role = 'size';
  sizeTag.textContent = '—';
  tags.appendChild(sizeTag);
  head.appendChild(tags);

  const desc = document.createElement('p');
  desc.className = 'script-card__desc';
  desc.textContent = script.desc;

  const points = document.createElement('ul');
  points.className = 'script-card__points';
  for (const p of script.points) {
    const li = document.createElement('li');
    li.textContent = p;
    points.appendChild(li);
  }

  const actions = document.createElement('div');
  actions.className = 'script-card__actions';
  const link = document.createElement('a');
  link.className = 'btn btn-primary';
  link.href = script.url;
  link.download = script.file;
  link.textContent = '下载 ' + script.file;
  actions.appendChild(link);
  // zip 是压缩包，浏览器里打开没有意义，只有单文件脚本才提供「查看内容」
  if (!script.zip) {
    const fileLink = document.createElement('a');
    fileLink.className = 'script-card__file';
    fileLink.href = script.url;
    fileLink.target = '_blank';
    fileLink.rel = 'noopener';
    fileLink.textContent = '查看内容';
    actions.appendChild(fileLink);
  }

  card.appendChild(head);
  card.appendChild(desc);
  card.appendChild(points);
  card.appendChild(actions);
  return card;
}

function initScripts() {
  const list = document.getElementById('script-list');
  if (!list) return;
  list.innerHTML = '';
  for (const script of SCRIPTS) {
    const card = renderScript(script);
    list.appendChild(card);
    loadSize(script.url).then((size) => {
      const tag = card.querySelector('[data-role="size"]');
      if (tag && size) tag.textContent = size;
    });
  }
}

export { initScripts };
