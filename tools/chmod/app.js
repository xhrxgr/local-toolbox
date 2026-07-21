/**
 * Unix 权限计算器（chmod）
 * 全部本地处理，无依赖
 *
 * 三组权限：owner / group / other × r(4) / w(2) / x(1)
 * 特殊位：setuid(4000) / setgid(2000) / sticky(1000)
 */

function initChmod() {
  const $ = (id) => document.getElementById(id);

  /* ========== 从复选框计算权限 ========== */
  function computeFromCheckboxes() {
    let owner = 0, group = 0, other = 0, special = 0;

    document.querySelectorAll('.chk input[type="checkbox"]').forEach(cb => {
      const cls = cb.dataset.class;
      const bit = parseInt(cb.dataset.bit, 10);
      if (cb.checked) {
        if (cls === 'owner') owner |= bit;
        else if (cls === 'group') group |= bit;
        else if (cls === 'other') other |= bit;
      }
    });

    if ($('spec-setuid').checked) special |= 4000;
    if ($('spec-setgid').checked) special |= 2000;
    if ($('spec-sticky').checked) special |= 1000;

    // 特殊位与 x 位的交互：
    // - setuid 启用且 owner.x 已勾选 → 符号显示 's'，否则 'S'
    // - setgid 启用且 group.x 已勾选 → 's'，否则 'S'
    // - sticky 启用且 other.x 已勾选 → 't'，否则 'T'
    return { owner, group, other, special };
  }

  /* ========== 数字格式（4 位或 3 位） ========== */
  function toNumeric({ owner, group, other, special }) {
    const three = `${owner}${group}${other}`;
    return special > 0 ? `${special / 1000}${three}` : three;
  }

  /* ========== 符号格式（10 位） ========== */
  function toSymbolic({ owner, group, other, special }) {
    const triplet = (n, specialBit, execChar, specialChar) => {
      let s = '';
      s += (n & 4) ? 'r' : '-';
      s += (n & 2) ? 'w' : '-';
      if (specialBit) {
        s += (n & 1) ? specialChar.toLowerCase() : specialChar.toUpperCase();
      } else {
        s += (n & 1) ? execChar : '-';
      }
      return s;
    };
    const ownerStr = triplet(owner, special & 4000, 'x', 's');
    const groupStr = triplet(group, special & 2000, 'x', 's');
    const otherStr = triplet(other, special & 1000, 'x', 't');
    return ownerStr + groupStr + otherStr;
  }

  /* ========== 命令预览 ========== */
  function toCommand(num) {
    return `chmod ${num} file`;
  }

  /* ========== 解释说明 ========== */
  function explain({ owner, group, other, special }) {
    const parts = [];
    if (owner === 7) parts.push('所有者可读写执行');
    else if (owner === 6) parts.push('所有者可读写');
    else if (owner === 5) parts.push('所有者可读执行');
    else if (owner === 4) parts.push('所有者只读');
    else if (owner === 0) parts.push('所有者无权限');

    if (group === 7) parts.push('用户组可读写执行');
    else if (group === 5) parts.push('用户组可读执行');
    else if (group === 4) parts.push('用户组只读');
    else if (group === 0) parts.push('用户组无权限');

    if (other === 5) parts.push('其他人可读执行');
    else if (other === 4) parts.push('其他人只读');
    else if (other === 0) parts.push('其他人无权限');
    else if (other === 7) parts.push('其他人可读写执行（注意安全）');

    if (special & 4000) parts.push('setuid：以所有者身份执行');
    if (special & 2000) parts.push('setgid：以用户组身份执行');
    if (special & 1000) parts.push('sticky：仅所有者可删除');

    return parts.join(' · ');
  }

  /* ========== 更新输出 ========== */
  function update() {
    const perm = computeFromCheckboxes();
    const num = toNumeric(perm);
    const sym = toSymbolic(perm);
    $('chmod-num').textContent = num;
    $('chmod-sym').textContent = sym;
    $('chmod-cmd').textContent = toCommand(num);
    $('chmod-explain').textContent = explain(perm);
  }

  /* ========== 从数字反查（设置复选框） ========== */
  function applyFromNumeric(numStr) {
    const cleaned = numStr.trim().replace(/\D/g, '');
    if (!cleaned) return;
    let special = 0, owner = 0, group = 0, other = 0;
    if (cleaned.length === 4) {
      special = parseInt(cleaned[0], 10) * 1000;
      owner = parseInt(cleaned[1], 10);
      group = parseInt(cleaned[2], 10);
      other = parseInt(cleaned[3], 10);
    } else if (cleaned.length === 3) {
      owner = parseInt(cleaned[0], 10);
      group = parseInt(cleaned[1], 10);
      other = parseInt(cleaned[2], 10);
    } else {
      throw new Error('数字格式应为 3 位或 4 位');
    }
    if (owner > 7 || group > 7 || other > 7 || (special / 1000) > 7) {
      throw new Error('每位数字应在 0-7 之间');
    }

    // 设置复选框
    document.querySelectorAll('.chk input[type="checkbox"]').forEach(cb => {
      const cls = cb.dataset.class;
      const bit = parseInt(cb.dataset.bit, 10);
      const val = cls === 'owner' ? owner : (cls === 'group' ? group : other);
      cb.checked = (val & bit) === bit;
    });
    $('spec-setuid').checked = (special & 4000) === 4000;
    $('spec-setgid').checked = (special & 2000) === 2000;
    $('spec-sticky').checked = (special & 1000) === 1000;

    update();
  }

  /* ========== 事件绑定 ========== */
  document.querySelectorAll('.chk input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', update);
  });
  ['spec-setuid', 'spec-setgid', 'spec-sticky'].forEach(id => {
    $(id).addEventListener('change', update);
  });

  $('btn-from-num').addEventListener('click', () => {
    try {
      applyFromNumeric($('chmod-num-input').value);
    } catch (e) {
      alert(e.message);
    }
  });

  $('chmod-num-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btn-from-num').click();
    }
  });

  // 复制按钮
  ['num', 'sym', 'cmd'].forEach(k => {
    $('btn-copy-' + k).addEventListener('click', () => {
      const text = $('chmod-' + k).textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = $('btn-copy-' + k);
        const orig = btn.textContent;
        btn.textContent = '已复制';
        btn.classList.add('meta-btn--success');
        setTimeout(() => {
          btn.textContent = orig;
          btn.classList.remove('meta-btn--success');
        }, 1500);
      });
    });
  });

  // 初始化
  update();
}

export { initChmod };
