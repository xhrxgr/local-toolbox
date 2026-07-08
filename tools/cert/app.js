/**
 * SSL/TLS 证书解析工具
 *
 * 实现策略：内置 ASN.1 DER 解析器（纯前端，支持所有现代浏览器）
 * 支持 PEM / DER Hex / DER Base64 三种输入格式
 *
 * 全部本地解析，证书不上传服务器
 */

/* ========== PEM ↔ DER ========== */
function pemToDer(pem) {
  // 提取 -----BEGIN ...----- ... -----END ...----- 之间的内容
  const match = pem.match(/-----BEGIN CERTIFICATE-----(?:[\s\S]*?)-----END CERTIFICATE-----/);
  if (!match) {
    throw new Error('未找到有效的 PEM 证书块（需包含 -----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----）');
  }
  const b64 = match[0]
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');
  if (!b64) throw new Error('PEM 证书内容为空');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function derToPem(der) {
  let bin = '';
  for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

/* ========== 工具函数 ========== */
function bytesToHex(bytes, sep = ':') {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(sep);
}

function bytesToHexUpper(bytes, sep = ':') {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(sep);
}

async function sha256(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHexUpper(new Uint8Array(hash));
}

async function sha1(bytes) {
  const hash = await crypto.subtle.digest('SHA-1', bytes);
  return bytesToHexUpper(new Uint8Array(hash));
}

function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '无效日期';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/* ========== ASN.1 DER 解析器（兜底方案）========== */
// 标签常量
const ASN1 = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0C,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
  CONTEXT_0: 0xA0, // [0]
  CONTEXT_3: 0xA3, // [3] extensions
};

function parseTlv(bytes, offset) {
  if (offset >= bytes.length) throw new Error('解析溢出');
  const tag = bytes[offset];
  const lengthByte = bytes[offset + 1];
  let length;
  let valueOffset;
  if (lengthByte < 0x80) {
    length = lengthByte;
    valueOffset = offset + 2;
  } else {
    const numBytes = lengthByte & 0x7F;
    if (numBytes === 0) throw new Error('不支持 indefinite length');
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | bytes[offset + 2 + i];
    }
    valueOffset = offset + 2 + numBytes;
  }
  return {
    tag,
    length,
    valueOffset,
    totalLength: valueOffset - offset + length,
    value: bytes.subarray(valueOffset, valueOffset + length),
  };
}

function parseChildren(bytes) {
  const children = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tlv = parseTlv(bytes, offset);
    children.push(tlv);
    offset += tlv.totalLength; // totalLength 是当前 TLV 的长度，不是绝对偏移
  }
  return children;
}

// OID 数据库（仅证书常用）
const OID_DB = {
  '1.2.840.113549.1.1.1': { name: 'rsaEncryption', desc: 'RSA 公钥' },
  '1.2.840.113549.1.1.5': { name: 'sha1WithRSAEncryption', desc: 'SHA-1 with RSA' },
  '1.2.840.113549.1.1.11': { name: 'sha256WithRSAEncryption', desc: 'SHA-256 with RSA' },
  '1.2.840.113549.1.1.12': { name: 'sha384WithRSAEncryption', desc: 'SHA-384 with RSA' },
  '1.2.840.113549.1.1.13': { name: 'sha512WithRSAEncryption', desc: 'SHA-512 with RSA' },
  '1.2.840.10045.2.1': { name: 'ecPublicKey', desc: 'ECDSA 公钥' },
  '1.2.840.10045.4.3.2': { name: 'ecdsa-with-SHA256', desc: 'ECDSA with SHA-256' },
  '1.2.840.10045.4.3.3': { name: 'ecdsa-with-SHA384', desc: 'ECDSA with SHA-384' },
  '1.2.840.10045.4.3.4': { name: 'ecdsa-with-SHA512', desc: 'ECDSA with SHA-512' },
  '1.2.840.10045.3.1.7': { name: 'prime256v1', desc: 'P-256 (secp256r1)' },
  '1.3.132.0.34': { name: 'secp384r1', desc: 'P-384' },
  '1.3.132.0.35': { name: 'secp521r1', desc: 'P-521' },
  '1.3.6.1.5.5.7.1.1': { name: 'authorityInfoAccess', desc: 'Authority Information Access' },
  '1.3.6.1.5.5.7.1.11': { name: 'subjectInfoAccess', desc: 'Subject Information Access' },
  '1.3.6.1.5.5.7.2.1': { name: 'id-qt-cps', desc: 'CPS Qualifier' },
  '2.5.4.3': { name: 'CN', desc: 'Common Name' },
  '2.5.4.6': { name: 'C', desc: 'Country' },
  '2.5.4.7': { name: 'L', desc: 'Locality' },
  '2.5.4.8': { name: 'ST', desc: 'State/Province' },
  '2.5.4.9': { name: 'street', desc: 'Street' },
  '2.5.4.10': { name: 'O', desc: 'Organization' },
  '2.5.4.11': { name: 'OU', desc: 'Organizational Unit' },
  '2.5.29.14': { name: 'subjectKeyIdentifier', desc: 'Subject Key Identifier' },
  '2.5.29.15': { name: 'keyUsage', desc: 'Key Usage' },
  '2.5.29.17': { name: 'subjectAltName', desc: 'Subject Alternative Name' },
  '2.5.29.19': { name: 'basicConstraints', desc: 'Basic Constraints' },
  '2.5.29.31': { name: 'crlDistributionPoints', desc: 'CRL Distribution Points' },
  '2.5.29.32': { name: 'certificatePolicies', desc: 'Certificate Policies' },
  '2.5.29.35': { name: 'authorityKeyIdentifier', desc: 'Authority Key Identifier' },
  '2.5.29.37': { name: 'extKeyUsage', desc: 'Extended Key Usage' },
  '1.3.6.1.5.5.7.3.1': { name: 'serverAuth', desc: 'TLS Web Server Authentication' },
  '1.3.6.1.5.5.7.3.2': { name: 'clientAuth', desc: 'TLS Web Client Authentication' },
};

function parseOid(bytes) {
  if (bytes.length < 1) return '';
  let result = `${Math.floor(bytes[0] / 40)}.${bytes[0] % 40}`;
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = (value << 7) | (bytes[i] & 0x7F);
    if (!(bytes[i] & 0x80)) {
      result += `.${value}`;
      value = 0;
    }
  }
  return result;
}

function oidInfo(oid) {
  const db = OID_DB[oid];
  return db ? `${db.desc} (${oid})` : oid;
}

function parseName(bytes) {
  // Name ::= SEQUENCE OF RelativeDistinguishedName
  // RelativeDistinguishedName ::= SET OF AttributeTypeAndValue
  // AttributeTypeAndValue ::= SEQUENCE { type OID, value }
  const rdns = [];
  const rdnSeqs = parseChildren(bytes);
  for (const rdnSet of rdnSeqs) {
    if (rdnSet.tag !== ASN1.SET) continue;
    const atvs = parseChildren(rdnSet.value);
    for (const atv of atvs) {
      if (atv.tag !== ASN1.SEQUENCE) continue;
      const parts = parseChildren(atv.value);
      if (parts.length < 2) continue;
      const oid = parseOid(parts[0].value);
      const valBytes = parts[1].value;
      let value;
      if (parts[1].tag === ASN1.UTF8_STRING || parts[1].tag === ASN1.IA5_STRING || parts[1].tag === ASN1.PRINTABLE_STRING) {
        value = new TextDecoder('utf-8').decode(valBytes);
      } else {
        value = new TextDecoder('latin1').decode(valBytes);
      }
      const oidDb = OID_DB[oid];
      const key = oidDb ? oidDb.name : oid;
      rdns.push({ key, value });
    }
  }
  return rdns;
}

function formatRdn(rdns) {
  // RFC 4514: 反向输出，用逗号分隔
  return rdns.slice().reverse().map((r) => `${r.key}=${r.value}`).join(', ');
}

function parseTime(tlv) {
  const str = new TextDecoder('latin1').decode(tlv.value);
  if (tlv.tag === ASN1.UTC_TIME) {
    // YYMMDDHHMMSSZ
    const yy = parseInt(str.slice(0, 2), 10);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return new Date(Date.UTC(year, parseInt(str.slice(2, 4), 10) - 1, parseInt(str.slice(4, 6), 10),
      parseInt(str.slice(6, 8), 10), parseInt(str.slice(8, 10), 10), parseInt(str.slice(10, 12), 10)));
  } else if (tlv.tag === ASN1.GENERALIZED_TIME) {
    // YYYYMMDDHHMMSSZ
    return new Date(Date.UTC(
      parseInt(str.slice(0, 4), 10),
      parseInt(str.slice(4, 6), 10) - 1,
      parseInt(str.slice(6, 8), 10),
      parseInt(str.slice(8, 10), 10),
      parseInt(str.slice(10, 12), 10),
      parseInt(str.slice(12, 14), 10)
    ));
  }
  return null;
}

// 解析 Subject Alternative Name 扩展
function parseSanExtension(extBytes) {
  const seq = parseTlv(extBytes, 0);
  if (seq.tag !== ASN1.SEQUENCE) return [];
  const names = [];
  let offset = 0;
  while (offset < seq.value.length) {
    const tlv = parseTlv(seq.value, offset);
    const tag = tlv.tag & 0x1F; // context-specific tag number
    const val = new TextDecoder('utf-8').decode(tlv.value);
    let type;
    switch (tag) {
      case 1: type = 'email'; break;
      case 2: type = 'DNS'; break;
      case 6: type = 'URI'; break;
      case 7: type = 'IP'; break;
      default: type = `other[${tag}]`;
    }
    names.push({ type, value: val });
    offset += tlv.totalLength;
  }
  return names;
}

// 解析 Key Usage 扩展（BIT STRING）
function parseKeyUsageExtension(extBytes) {
  const bs = parseTlv(extBytes, 0);
  if (bs.tag !== ASN1.BIT_STRING) return [];
  // 第一个字节是未使用位数
  if (bs.value.length < 2) return [];
  const unused = bs.value[0];
  const bits = bs.value.slice(1);
  const usages = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment',
    'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'];
  const result = [];
  for (let i = 0; i < usages.length; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    if (byteIdx < bits.length && (bits[byteIdx] & (1 << bitIdx))) {
      result.push(usages[i]);
    }
  }
  return result;
}

// 解析 Basic Constraints
function parseBasicConstraints(extBytes) {
  const seq = parseTlv(extBytes, 0);
  if (seq.tag !== ASN1.SEQUENCE) return {};
  const children = parseChildren(seq.value);
  let isCA = false;
  let pathLen;
  for (const child of children) {
    if (child.tag === ASN1.BOOLEAN && child.value.length > 0) {
      isCA = child.value[0] !== 0;
    } else if (child.tag === ASN1.INTEGER) {
      let v = 0;
      for (const b of child.value) v = (v << 8) | b;
      pathLen = v;
    }
  }
  return { isCA, pathLen };
}

// 从扩展数组中查找指定 OID 的扩展
function findExtension(extensions, oid) {
  for (const ext of extensions) {
    if (ext.oid === oid) return ext;
  }
  return null;
}

// 解析所有扩展
function parseExtensions(extSeqBytes) {
  const exts = [];
  const extSeq = parseTlv(extSeqBytes, 0);
  if (extSeq.tag !== ASN1.SEQUENCE) return exts;
  const extChildren = parseChildren(extSeq.value);
  for (const ext of extChildren) {
    if (ext.tag !== ASN1.SEQUENCE) continue;
    const parts = parseChildren(ext.value);
    if (parts.length < 2) continue;
    const oid = parseOid(parts[0].value);
    let valueIdx = 1;
    let critical = false;
    if (parts[1].tag === ASN1.BOOLEAN) {
      critical = parts[1].value[0] !== 0;
      valueIdx = 2;
    }
    if (valueIdx >= parts.length) continue;
    const extValue = parts[valueIdx]; // OCTET STRING
    exts.push({
      oid,
      critical,
      value: extValue.value, // 解出来后是扩展的实际 DER
    });
  }
  return exts;
}

// 从 DER 解析证书
function parseCertFromDer(der) {
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  const certSeq = parseTlv(der, 0);
  if (certSeq.tag !== ASN1.SEQUENCE) throw new Error('证书根结构无效');
  const certChildren = parseChildren(certSeq.value);
  if (certChildren.length < 3) throw new Error('证书结构不完整');
  const tbs = certChildren[0];
  const sigAlg = certChildren[1];
  const sigValue = certChildren[2];

  // TBSCertificate ::= SEQUENCE {
  //   version [0] EXPLICIT Version DEFAULT v1,
  //   serialNumber CertificateSerialNumber,
  //   signature AlgorithmIdentifier,
  //   issuer Name,
  //   validity Validity,
  //   subject Name,
  //   subjectPublicKeyInfo SubjectPublicKeyInfo,
  //   ... extensions [3] EXPLICIT
  // }
  const tbsChildren = parseChildren(tbs.value);
  let idx = 0;
  let version = 0;
  if (tbsChildren[0].tag === ASN1.CONTEXT_0) {
    const verInt = parseTlv(tbsChildren[0].value, 0);
    if (verInt.tag === ASN1.INTEGER && verInt.value.length > 0) {
      version = verInt.value[0];
    }
    idx = 1;
  }
  const serialNumber = tbsChildren[idx++];
  const innerSigAlg = tbsChildren[idx++];
  const issuer = tbsChildren[idx++];
  const validity = tbsChildren[idx++];
  const subject = tbsChildren[idx++];
  const spki = tbsChildren[idx++];
  // 剩下可能是 extensions（[3]）
  let extensions = [];
  while (idx < tbsChildren.length) {
    if (tbsChildren[idx].tag === ASN1.CONTEXT_3) {
      extensions = parseExtensions(tbsChildren[idx].value);
    }
    idx++;
  }

  // 序列号
  let serialHex = '';
  for (const b of serialNumber.value) serialHex += b.toString(16).padStart(2, '0').toUpperCase();
  // 去掉前导 00（如果是为了对齐正数）
  if (serialHex.startsWith('00') && serialHex.length > 2) serialHex = serialHex.slice(2);

  // 签名算法
  const sigAlgOid = parseOid(parseChildren(sigAlg.value)[0].value);

  // 主题 / 签发者
  const subjectRdns = parseName(subject.value);
  const issuerRdns = parseName(issuer.value);

  // 有效期
  const validityChildren = parseChildren(validity.value);
  const notBefore = parseTime(validityChildren[0]);
  const notAfter = parseTime(validityChildren[1]);

  // 公钥信息
  const spkiChildren = parseChildren(spki.value);
  const pkAlgOid = parseOid(parseChildren(spkiChildren[0].value)[0].value);
  const pkBitString = spkiChildren[1];

  // 公钥算法特定解析
  let keyInfo = { algOid: pkAlgOid };
  if (pkAlgOid === '1.2.840.113549.1.1.1') {
    // RSA: BIT STRING 内容是 RSAPublicKey SEQUENCE { modulus INTEGER, publicExponent INTEGER }
    const rsaSeq = parseTlv(pkBitString.value.slice(1), 0); // 跳过 BIT STRING 的 unused bits 字节
    if (rsaSeq.tag === ASN1.SEQUENCE) {
      const rsaParts = parseChildren(rsaSeq.value);
      if (rsaParts.length >= 2) {
        const modulus = rsaParts[0];
        const exponent = rsaParts[1];
        let modulusHex = '';
        for (const b of modulus.value) modulusHex += b.toString(16).padStart(2, '0');
        // 去掉前导 00
        if (modulusHex.startsWith('00') && modulusHex.length > 2) modulusHex = modulusHex.slice(2);
        let expHex = '';
        for (const b of exponent.value) expHex += b.toString(16).padStart(2, '0');
        if (expHex.startsWith('00') && expHex.length > 2) expHex = expHex.slice(2);
        keyInfo.modulusBits = modulus.value[0] === 0 ? (modulus.value.length - 1) * 8 : modulus.value.length * 8;
        keyInfo.modulusHex = modulusHex.toUpperCase();
        keyInfo.exponent = parseInt(expHex || '0', 16);
      }
    }
  } else if (pkAlgOid === '1.2.840.10045.2.1') {
    // ECDSA: 算法参数是曲线 OID
    const algChildren = parseChildren(spkiChildren[0].value);
    if (algChildren.length >= 2) {
      const curveOid = parseOid(algChildren[1].value);
      keyInfo.curve = curveOid;
    }
    // 公钥是 BIT STRING
    keyInfo.publicKeyHex = bytesToHexUpper(pkBitString.value.slice(1));
  }

  // 扩展解析
  let san = [];
  let keyUsage = [];
  let extKeyUsage = [];
  let basicConstraints = {};
  if (extensions.length > 0) {
    const sanExt = findExtension(extensions, '2.5.29.17');
    if (sanExt) san = parseSanExtension(sanExt.value);
    const kuExt = findExtension(extensions, '2.5.29.15');
    if (kuExt) keyUsage = parseKeyUsageExtension(kuExt.value);
    const bcExt = findExtension(extensions, '2.5.29.19');
    if (bcExt) basicConstraints = parseBasicConstraints(bcExt.value);
    const ekuExt = findExtension(extensions, '2.5.29.37');
    if (ekuExt) {
      // EKU 是 SEQUENCE OF OID
      const ekuSeq = parseTlv(ekuExt.value, 0);
      if (ekuSeq.tag === ASN1.SEQUENCE) {
        for (const oidTlv of parseChildren(ekuSeq.value)) {
          if (oidTlv.tag === ASN1.OID) {
            const oid = parseOid(oidTlv.value);
            const db = OID_DB[oid];
            extKeyUsage.push(db ? db.desc : oid);
          }
        }
      }
    }
  }

  return {
    version: version + 1,
    serialNumber: serialHex,
    sigAlgOid,
    issuer: issuerRdns,
    subject: subjectRdns,
    notBefore,
    notAfter,
    keyInfo,
    extensions: extensions.map((e) => ({ oid: e.oid, critical: e.critical })),
    san,
    keyUsage,
    extKeyUsage,
    basicConstraints,
    der,
  };
}

/* ========== 渲染 ========== */
function renderRow(label, value, opts = {}) {
  const valueHtml = opts.mono
    ? `<code class="info-value info-value--mono">${escapeHtml(value)}</code>`
    : `<span class="info-value">${escapeHtml(value)}</span>`;
  return `<div class="info-item"><span class="info-label">${escapeHtml(label)}</span>${valueHtml}</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderCertInfo(certInfo) {
  // 状态横幅
  const now = new Date();
  let statusHtml;
  if (now < certInfo.notBefore) {
    const days = daysBetween(now, certInfo.notBefore);
    statusHtml = `<div class="status-banner--pending">证书尚未生效 · 还有 ${days} 天生效</div>`;
  } else if (now > certInfo.notAfter) {
    const days = daysBetween(certInfo.notAfter, now);
    statusHtml = `<div class="status-banner--expired">证书已过期 · 已过期 ${days} 天</div>`;
  } else {
    const days = daysBetween(now, certInfo.notAfter);
    let cls = 'status-banner--valid';
    if (days < 30) cls = 'status-banner--warning';
    statusHtml = `<div class="${cls}">证书有效 · 还有 ${days} 天过期</div>`;
  }
  document.getElementById('cert-status').innerHTML = statusHtml;

  // 基本信息
  document.getElementById('info-basic').innerHTML =
    renderRow('版本', `v${certInfo.version}`) +
    renderRow('序列号', certInfo.serialNumber, { mono: true }) +
    renderRow('签名算法', oidInfo(certInfo.sigAlgOid), { mono: true });

  // 主题与签发者
  let subjectHtml = '';
  certInfo.subject.forEach((rdn) => {
    subjectHtml += renderRow(rdn.key, rdn.value);
  });
  subjectHtml += `<div class="info-item info-item--full"><span class="info-label">RFC 4514</span><code class="info-value info-value--mono">${escapeHtml(formatRdn(certInfo.subject))}</code></div>`;
  subjectHtml += `<div class="info-item info-item--divider"></div>`;
  certInfo.issuer.forEach((rdn) => {
    subjectHtml += renderRow(`签发者 ${rdn.key}`, rdn.value);
  });
  subjectHtml += `<div class="info-item info-item--full"><span class="info-label">签发者 RFC 4514</span><code class="info-value info-value--mono">${escapeHtml(formatRdn(certInfo.issuer))}</code></div>`;
  document.getElementById('info-subject').innerHTML = subjectHtml;

  // 有效期
  const notBeforeStr = formatDate(certInfo.notBefore);
  const notAfterStr = formatDate(certInfo.notAfter);
  const validityDays = daysBetween(certInfo.notBefore, certInfo.notAfter);
  document.getElementById('info-validity').innerHTML =
    renderRow('生效时间', notBeforeStr) +
    renderRow('过期时间', notAfterStr) +
    renderRow('有效期长度', `${validityDays} 天（约 ${(validityDays / 365).toFixed(1)} 年）`);

  // 公钥信息
  let keyHtml = renderRow('公钥算法', oidInfo(certInfo.keyInfo.algOid), { mono: true });
  if (certInfo.keyInfo.modulusBits) {
    keyHtml += renderRow('密钥长度', `${certInfo.keyInfo.modulusBits} 位`);
    keyHtml += renderRow('公钥指数', `0x${certInfo.keyInfo.exponent.toString(16).toUpperCase()} (${certInfo.keyInfo.exponent})`, { mono: true });
    keyHtml += `<div class="info-item info-item--full"><span class="info-label">模数 (hex)</span><code class="info-value info-value--mono info-value--break">${escapeHtml(certInfo.keyInfo.modulusHex)}</code></div>`;
  } else if (certInfo.keyInfo.curve) {
    keyHtml += renderRow('曲线', oidInfo(certInfo.keyInfo.curve), { mono: true });
    if (certInfo.keyInfo.publicKeyHex) {
      keyHtml += `<div class="info-item info-item--full"><span class="info-label">公钥点 (hex)</span><code class="info-value info-value--mono info-value--break">${escapeHtml(certInfo.keyInfo.publicKeyHex)}</code></div>`;
    }
  }
  document.getElementById('info-key').innerHTML = keyHtml;

  // 扩展信息
  let extHtml = '';
  if (certInfo.basicConstraints && Object.keys(certInfo.basicConstraints).length > 0) {
    let bcStr = `CA: ${certInfo.basicConstraints.isCA ? '是' : '否'}`;
    if (certInfo.basicConstraints.pathLen !== undefined) {
      bcStr += `，路径长度限制: ${certInfo.basicConstraints.pathLen}`;
    }
    extHtml += renderRow('Basic Constraints', bcStr);
  }
  if (certInfo.keyUsage.length > 0) {
    extHtml += renderRow('Key Usage', certInfo.keyUsage.join('、'));
  }
  if (certInfo.extKeyUsage.length > 0) {
    extHtml += renderRow('Extended Key Usage', certInfo.extKeyUsage.join('、'));
  }
  if (certInfo.san.length > 0) {
    const sanStr = certInfo.san.map((s) => `${s.type}: ${s.value}`).join('，');
    extHtml += `<div class="info-item info-item--full"><span class="info-label">Subject AltName</span><code class="info-value info-value--mono">${escapeHtml(sanStr)}</code></div>`;
  }
  if (certInfo.extensions.length > 0) {
    const extList = certInfo.extensions.map((e) => {
      const db = OID_DB[e.oid];
      const name = db ? db.name : e.oid;
      return `${name}${e.critical ? ' (critical)' : ''}`;
    }).join('，');
    extHtml += `<div class="info-item info-item--full"><span class="info-label">所有扩展</span><code class="info-value info-value--mono">${escapeHtml(extList)}</code></div>`;
  }
  if (!extHtml) extHtml = '<div class="info-item"><span class="info-value info-value--empty">无扩展信息</span></div>';
  document.getElementById('info-extensions').innerHTML = extHtml;
}

async function renderFingerprints(der) {
  const [sha256Fp, sha1Fp] = await Promise.all([sha256(der), sha1(der)]);
  document.getElementById('info-fingerprint').innerHTML =
    `<div class="info-item info-item--full"><span class="info-label">SHA-256</span><code class="info-value info-value--mono info-value--break">${sha256Fp}</code></div>` +
    `<div class="info-item info-item--full"><span class="info-label">SHA-1</span><code class="info-value info-value--mono info-value--break">${sha1Fp}</code></div>`;
}

/* ========== 主流程 ========== */
async function parseCert() {
  const inputEl = document.getElementById('cert-input');
  const input = inputEl.value.trim();
  const errorSection = document.getElementById('error-section');
  const resultSection = document.getElementById('result-section');
  const emptyState = document.getElementById('empty-state');

  errorSection.hidden = true;
  resultSection.hidden = true;
  emptyState.hidden = !input;

  if (!input) {
    return;
  }

  try {
    let der;
    // 判断是 PEM 还是 DER（hex/base64）
    if (/-----BEGIN CERTIFICATE-----/.test(input)) {
      der = pemToDer(input);
    } else if (/^[0-9a-fA-F\s]+$/i.test(input) && input.replace(/\s/g, '').length % 2 === 0) {
      // Hex
      const hex = input.replace(/\s/g, '');
      der = new Uint8Array(hex.length / 2);
      for (let i = 0; i < der.length; i++) der[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    } else {
      // 尝试 Base64
      try {
        const bin = atob(input.replace(/\s+/g, ''));
        der = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
      } catch {
        throw new Error('无法识别证书格式（支持 PEM / DER Hex / DER Base64）');
      }
    }

    // 使用内置 ASN.1 DER 解析器
    const certInfo = parseCertFromDer(der);

    renderCertInfo(certInfo);

    // 先显示结果区，再异步渲染指纹（避免指纹失败影响主流程）
    resultSection.hidden = false;
    emptyState.hidden = true;

    try {
      await renderFingerprints(der);
    } catch (fpErr) {
      document.getElementById('info-fingerprint').innerHTML =
        `<div class="info-item info-item--full"><span class="info-value info-value--empty">指纹计算失败：${escapeHtml(fpErr.message)}</span></div>`;
    }
  } catch (e) {
    showError(e.message + (e.stack ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : ''));
    errorSection.hidden = false;
    resultSection.hidden = true;
    emptyState.hidden = true;
  }
}

function showError(msg) {
  const section = document.getElementById('error-section');
  section.innerHTML = `<div class="error-box">${escapeHtml(msg)}</div>`;
  section.hidden = false;
}

function clearAll() {
  document.getElementById('cert-input').value = '';
  document.getElementById('cert-file').value = '';
  document.getElementById('error-section').hidden = true;
  document.getElementById('result-section').hidden = true;
  document.getElementById('empty-state').hidden = false;
}

function loadSample() {
  // Let's Encrypt R10 中间证书（Let's Encrypt 官方公开签名链，2024-2027）
  const sample = `-----BEGIN CERTIFICATE-----
MIIFBTCCAu2gAwIBAgIQS6hSk/eaL6JzBkuoBI110DANBgkqhkiG9w0BAQsFADBP
MQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFy
Y2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMTAeFw0yNDAzMTMwMDAwMDBa
Fw0yNzAzMTIyMzU5NTlaMDMxCzAJBgNVBAYTAlVTMRYwFAYDVQQKEw1MZXQncyBF
bmNyeXB0MQwwCgYDVQQDEwNSMTAwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQDPV+XmxFQS7bRH/sknWHZGUCiMHT6I3wWd1bUYKb3dtVq/+vbOo76vACFL
YlpaPAEvxVgD9on/jhFD68G14BQHlo9vH9fnuoE5CXVlt8KvGFs3Jijno/QHK20a
/6tYvJWuQP/py1fEtVt/eA0YYbwX51TGu0mRzW4Y0YCF7qZlNrx06rxQTOr8IfM4
FpOUurDTazgGzRYSespSdcitdrLCnF2YRVxvYXvGLe48E1KGAdlX5jgc3421H5KR
mudKHMxFqHJV8LDmowfs/acbZp4/SItxhHFYyTr6717yW0QrPHTnj7JHwQdqzZq3
DZb3EoEmUVQK7GH29/Xi8orIlQ2NAgMBAAGjgfgwgfUwDgYDVR0PAQH/BAQDAgGG
MB0GA1UdJQQWMBQGCCsGAQUFBwMCBggrBgEFBQcDATASBgNVHRMBAf8ECDAGAQH/
AgEAMB0GA1UdDgQWBBS7vMNHpeS8qcbDpHIMEI2iNeHI6DAfBgNVHSMEGDAWgBR5
tFnme7bl5AFzgAiIyBpY9umbbjAyBggrBgEFBQcBAQQmMCQwIgYIKwYBBQUHMAKG
Fmh0dHA6Ly94MS5pLmxlbmNyLm9yZy8wEwYDVR0gBAwwCjAIBgZngQwBAgEwJwYD
VR0fBCAwHjAcoBqgGIYWaHR0cDovL3gxLmMubGVuY3Iub3JnLzANBgkqhkiG9w0B
AQsFAAOCAgEAkrHnQTfreZ2B5s3iJeE6IOmQRJWjgVzPw139vaBw1bGWKCIL0vIo
zwzn1OZDjCQiHcFCktEJr59L9MhwTyAWsVrdAfYf+B9haxQnsHKNY67u4s5Lzzfd
u6PUzeetUK29v+PsPmI2cJkxp+iN3epi4hKu9ZzUPSwMqtCceb7qPVxEbpYxY1p9
1n5PJKBLBX9eb9LU6l8zSxPWV7bK3lG4XaMJgnT9x3ies7msFtpKK5bDtotij/l0
GaKeA97pb5uwD9KgWvaFXMIEt8jVTjLEvwRdvCn294GPDF08U8lAkIv7tghluaQh
1QnlE4SEN4LOECj8dsIGJXpGUk3aU3KkJz9icKy+aUgA+2cP21uh6NcDIS3XyfaZ
QjmDQ993ChII8SXWupQZVBiIpcWO4RqZk3lr7Bz5MUCwzDIA359e57SSq5CCkY0N
4B6Vulk7LktfwrdGNVI5BsC9qqxSwSKgRJeZ9wygIaehbHFHFhcBaMDKpiZlBHyz
rsnnlFXCb5s8HKn5LsUgGvB24L7sGNZP2CX7dhHov+YhD+jozLW2p9W4959Bz2Ei
RmqDtmiXLnzqTpXbI+suyCsohKRg6Un0RC47+cpiVwHiXZAW+cn8eiNIjqbVgXLx
KPpdzvvtTnOPlC7SQZSYmdunr3Bf9b77AiC/ZidstK36dRILKz7OA54=
-----END CERTIFICATE-----`;
  document.getElementById('cert-input').value = sample;
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let content = e.target.result;
    if (file.name.match(/\.(der|crt|cer)$/i) && !/-----BEGIN/.test(content)) {
      // 二进制 DER 文件，转 hex
      const bytes = new Uint8Array(content);
      if (file.type === 'application/octet-stream' || file.type === '') {
        // 转 PEM
        const der = bytes;
        document.getElementById('cert-input').value = derToPem(der);
      } else {
        document.getElementById('cert-input').value = content;
      }
    } else {
      document.getElementById('cert-input').value = content;
    }
  };
  // 优先以文本读取（PEM 是文本）
  if (file.name.match(/\.der$/i)) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}

/* ========== 初始化 ========== */
function initCert() {
  document.getElementById('btn-parse').addEventListener('click', parseCert);
  document.getElementById('btn-clear').addEventListener('click', clearAll);
  document.getElementById('btn-sample').addEventListener('click', loadSample);

  document.getElementById('cert-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  // 支持拖放
  const inputEl = document.getElementById('cert-input');
  inputEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    inputEl.classList.add('cert-input--drag');
  });
  inputEl.addEventListener('dragleave', () => {
    inputEl.classList.remove('cert-input--drag');
  });
  inputEl.addEventListener('drop', (e) => {
    e.preventDefault();
    inputEl.classList.remove('cert-input--drag');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Ctrl+Enter 触发解析
  inputEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      parseCert();
    }
  });
}

export { initCert };
