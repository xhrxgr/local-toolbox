import{t as e}from"./marked.esm-Ccg6WR5l.js";import{n as t}from"./utils-C_jljpDO.js";function n(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e}function r(e,t){return Array(t+1).join(e)}function i(e){return e.replace(/^\n*/,``)}function a(e){for(var t=e.length;t>0&&e[t-1]===`
`;)t--;return e.substring(0,t)}function o(e){return a(i(e))}var s=`ADDRESS.ARTICLE.ASIDE.AUDIO.BLOCKQUOTE.BODY.CANVAS.CENTER.DD.DIR.DIV.DL.DT.FIELDSET.FIGCAPTION.FIGURE.FOOTER.FORM.FRAMESET.H1.H2.H3.H4.H5.H6.HEADER.HGROUP.HR.HTML.ISINDEX.LI.MAIN.MENU.NAV.NOFRAMES.NOSCRIPT.OL.OUTPUT.P.PRE.SECTION.TABLE.TBODY.TD.TFOOT.TH.THEAD.TR.UL`.split(`.`);function c(e){return h(e,s)}var l=[`AREA`,`BASE`,`BR`,`COL`,`COMMAND`,`EMBED`,`HR`,`IMG`,`INPUT`,`KEYGEN`,`LINK`,`META`,`PARAM`,`SOURCE`,`TRACK`,`WBR`];function u(e){return h(e,l)}function d(e){return g(e,l)}var f=[`A`,`TABLE`,`THEAD`,`TBODY`,`TFOOT`,`TH`,`TD`,`IFRAME`,`SCRIPT`,`AUDIO`,`VIDEO`];function p(e){return h(e,f)}function m(e){return g(e,f)}function h(e,t){return t.indexOf(e.nodeName)>=0}function g(e,t){return e.getElementsByTagName&&t.some(function(t){return e.getElementsByTagName(t).length})}var ee=[[/\\/g,`\\\\`],[/\*/g,`\\*`],[/^-/g,`\\-`],[/^\+ /g,`\\+ `],[/^(=+)/g,`\\$1`],[/^(#{1,6}) /g,`\\$1 `],[/`/g,"\\`"],[/^~~~/g,`\\~~~`],[/\[/g,`\\[`],[/\]/g,`\\]`],[/^>/g,`\\>`],[/_/g,`\\_`],[/^(\d+)\. /g,`$1\\. `]];function _(e){return ee.reduce(function(e,t){return e.replace(t[0],t[1])},e)}var v={};v.paragraph={filter:`p`,replacement:function(e){return`

`+e+`

`}},v.lineBreak={filter:`br`,replacement:function(e,t,n){return n.br+`
`}},v.heading={filter:[`h1`,`h2`,`h3`,`h4`,`h5`,`h6`],replacement:function(e,t,n){var i=Number(t.nodeName.charAt(1));if(n.headingStyle===`setext`&&i<3){var a=r(i===1?`=`:`-`,e.length);return`

`+e+`
`+a+`

`}else return`

`+r(`#`,i)+` `+e+`

`}},v.blockquote={filter:`blockquote`,replacement:function(e){return e=o(e).replace(/^/gm,`> `),`

`+e+`

`}},v.list={filter:[`ul`,`ol`],replacement:function(e,t){var n=t.parentNode;return n.nodeName===`LI`&&n.lastElementChild===t?`
`+e:`

`+e+`

`}},v.listItem={filter:`li`,replacement:function(e,t,n){var r=n.bulletListMarker+`   `,i=t.parentNode;if(i.nodeName===`OL`){var a=i.getAttribute(`start`),s=Array.prototype.indexOf.call(i.children,t);r=(a?Number(a)+s:s+1)+`.  `}var c=/\n$/.test(e);return e=o(e)+(c?`
`:``),e=e.replace(/\n/gm,`
`+` `.repeat(r.length)),r+e+(t.nextSibling?`
`:``)}},v.indentedCodeBlock={filter:function(e,t){return t.codeBlockStyle===`indented`&&e.nodeName===`PRE`&&e.firstChild&&e.firstChild.nodeName===`CODE`},replacement:function(e,t,n){return`

    `+t.firstChild.textContent.replace(/\n/g,`
    `)+`

`}},v.fencedCodeBlock={filter:function(e,t){return t.codeBlockStyle===`fenced`&&e.nodeName===`PRE`&&e.firstChild&&e.firstChild.nodeName===`CODE`},replacement:function(e,t,n){for(var i=((t.firstChild.getAttribute(`class`)||``).match(/language-(\S+)/)||[null,``])[1],a=t.firstChild.textContent,o=n.fence.charAt(0),s=3,c=RegExp(`^`+o+`{3,}`,`gm`),l;l=c.exec(a);)l[0].length>=s&&(s=l[0].length+1);var u=r(o,s);return`

`+u+i+`
`+a.replace(/\n$/,``)+`
`+u+`

`}},v.horizontalRule={filter:`hr`,replacement:function(e,t,n){return`

`+n.hr+`

`}},v.inlineLink={filter:function(e,t){return t.linkStyle===`inlined`&&e.nodeName===`A`&&e.getAttribute(`href`)},replacement:function(e,t){var n=b(t.getAttribute(`href`)),r=x(y(t.getAttribute(`title`))),i=r?` "`+r+`"`:``;return`[`+e+`](`+n+i+`)`}},v.referenceLink={filter:function(e,t){return t.linkStyle===`referenced`&&e.nodeName===`A`&&e.getAttribute(`href`)},replacement:function(e,t,n){var r=b(t.getAttribute(`href`)),i=y(t.getAttribute(`title`));i&&=` "`+x(i)+`"`;var a,o;switch(n.linkReferenceStyle){case`collapsed`:a=`[`+e+`][]`,o=`[`+e+`]: `+r+i;break;case`shortcut`:a=`[`+e+`]`,o=`[`+e+`]: `+r+i;break;default:var s=this.references.length+1;a=`[`+e+`][`+s+`]`,o=`[`+s+`]: `+r+i}return this.references.push(o),a},references:[],append:function(e){var t=``;return this.references.length&&(t=`

`+this.references.join(`
`)+`

`,this.references=[]),t}},v.emphasis={filter:[`em`,`i`],replacement:function(e,t,n){return e.trim()?n.emDelimiter+e+n.emDelimiter:``}},v.strong={filter:[`strong`,`b`],replacement:function(e,t,n){return e.trim()?n.strongDelimiter+e+n.strongDelimiter:``}},v.code={filter:function(e){var t=e.previousSibling||e.nextSibling,n=e.parentNode.nodeName===`PRE`&&!t;return e.nodeName===`CODE`&&!n},replacement:function(e){if(!e)return``;e=e.replace(/\r?\n|\r/g,` `);for(var t=/^`|^ .*?[^ ].* $|`$/.test(e)?` `:``,n="`",r=e.match(/`+/gm)||[];r.indexOf(n)!==-1;)n+="`";return n+t+e+t+n}},v.image={filter:`img`,replacement:function(e,t){var n=_(y(t.getAttribute(`alt`))),r=b(t.getAttribute(`src`)||``),i=y(t.getAttribute(`title`)),a=i?` "`+x(i)+`"`:``;return r?`![`+n+`](`+r+a+`)`:``}};function y(e){return e?e.replace(/(\n+\s*)+/g,`
`):``}function b(e){var t=e.replace(/([<>()])/g,`\\$1`);return t.indexOf(` `)>=0?`<`+t+`>`:t}function x(e){return e.replace(/"/g,`\\"`)}function S(e){for(var t in this.options=e,this._keep=[],this._remove=[],this.blankRule={replacement:e.blankReplacement},this.keepReplacement=e.keepReplacement,this.defaultRule={replacement:e.defaultReplacement},this.array=[],e.rules)this.array.push(e.rules[t])}S.prototype={add:function(e,t){this.array.unshift(t)},keep:function(e){this._keep.unshift({filter:e,replacement:this.keepReplacement})},remove:function(e){this._remove.unshift({filter:e,replacement:function(){return``}})},forNode:function(e){if(e.isBlank)return this.blankRule;var t;return(t=C(this.array,e,this.options))||(t=C(this._keep,e,this.options))||(t=C(this._remove,e,this.options))?t:this.defaultRule},forEach:function(e){for(var t=0;t<this.array.length;t++)e(this.array[t],t)}};function C(e,t,n){for(var r=0;r<e.length;r++){var i=e[r];if(w(i,t,n))return i}}function w(e,t,n){var r=e.filter;if(typeof r==`string`){if(r===t.nodeName.toLowerCase())return!0}else if(Array.isArray(r)){if(r.indexOf(t.nodeName.toLowerCase())>-1)return!0}else if(typeof r==`function`){if(r.call(e,t,n))return!0}else throw TypeError("`filter` needs to be a string, array, or function")}function T(e){var t=e.element,n=e.isBlock,r=e.isVoid,i=e.isPre||function(e){return e.nodeName===`PRE`};if(!(!t.firstChild||i(t))){for(var a=null,o=!1,s=null,c=D(s,t,i);c!==t;){if(c.nodeType===3||c.nodeType===4){var l=c.data.replace(/[ \r\n\t]+/g,` `);if((!a||/ $/.test(a.data))&&!o&&l[0]===` `&&(l=l.substr(1)),!l){c=E(c);continue}c.data=l,a=c}else if(c.nodeType===1)n(c)||c.nodeName===`BR`?(a&&(a.data=a.data.replace(/ $/,``)),a=null,o=!1):r(c)||i(c)?(a=null,o=!0):a&&(o=!1);else{c=E(c);continue}var u=D(s,c,i);s=c,c=u}a&&(a.data=a.data.replace(/ $/,``),a.data||E(a))}}function E(e){var t=e.nextSibling||e.parentNode;return e.parentNode.removeChild(e),t}function D(e,t,n){return e&&e.parentNode===t||n(t)?t.nextSibling||t.parentNode:t.firstChild||t.nextSibling||t.parentNode}var O=typeof window<`u`?window:{};function k(){var e=O.DOMParser,t=!1;try{new e().parseFromString(``,`text/html`)&&(t=!0)}catch{}return t}function A(){var e=function(){};return j()?e.prototype.parseFromString=function(e){var t=new window.ActiveXObject(`htmlfile`);return t.designMode=`on`,t.open(),t.write(e),t.close(),t}:e.prototype.parseFromString=function(e){var t=document.implementation.createHTMLDocument(``);return t.open(),t.write(e),t.close(),t},e}function j(){var e=!1;try{document.implementation.createHTMLDocument(``).open()}catch{O.ActiveXObject&&(e=!0)}return e}var M=k()?O.DOMParser:A();function te(e,t){var n=typeof e==`string`?P().parseFromString(`<x-turndown id="turndown-root">`+e+`</x-turndown>`,`text/html`).getElementById(`turndown-root`):e.cloneNode(!0);return T({element:n,isBlock:c,isVoid:u,isPre:t.preformattedCode?F:null}),n}var N;function P(){return N||=new M,N}function F(e){return e.nodeName===`PRE`||e.nodeName===`CODE`}function I(e,t){return e.isBlock=c(e),e.isCode=e.nodeName===`CODE`||e.parentNode.isCode,e.isBlank=L(e),e.flankingWhitespace=R(e,t),e}function L(e){return!u(e)&&!p(e)&&/^\s*$/i.test(e.textContent)&&!d(e)&&!m(e)}function R(e,t){if(e.isBlock||t.preformattedCode&&e.isCode)return{leading:``,trailing:``};var n=z(e.textContent);return n.leadingAscii&&B(`left`,e,t)&&(n.leading=n.leadingNonAscii),n.trailingAscii&&B(`right`,e,t)&&(n.trailing=n.trailingNonAscii),{leading:n.leading,trailing:n.trailing}}function z(e){var t=e.match(/^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/);return{leading:t[1],leadingAscii:t[2],leadingNonAscii:t[3],trailing:t[4],trailingNonAscii:t[5],trailingAscii:t[6]}}function B(e,t,n){var r,i,a;return e===`left`?(r=t.previousSibling,i=/ $/):(r=t.nextSibling,i=/^ /),r&&(r.nodeType===3?a=i.test(r.nodeValue):n.preformattedCode&&r.nodeName===`CODE`?a=!1:r.nodeType===1&&!c(r)&&(a=i.test(r.textContent))),a}var V=Array.prototype.reduce;function H(e){if(!(this instanceof H))return new H(e);var t={rules:v,headingStyle:`setext`,hr:`* * *`,bulletListMarker:`*`,codeBlockStyle:`indented`,fence:"```",emDelimiter:`_`,strongDelimiter:`**`,linkStyle:`inlined`,linkReferenceStyle:`full`,br:`  `,preformattedCode:!1,blankReplacement:function(e,t){return t.isBlock?`

`:``},keepReplacement:function(e,t){return t.isBlock?`

`+t.outerHTML+`

`:t.outerHTML},defaultReplacement:function(e,t){return t.isBlock?`

`+e+`

`:e}};this.options=n({},t,e),this.rules=new S(this.options)}H.prototype={turndown:function(e){if(!q(e))throw TypeError(e+` is not a string, or an element/document/fragment node.`);if(e===``)return``;var t=U.call(this,new te(e,this.options));return W.call(this,t)},use:function(e){if(Array.isArray(e))for(var t=0;t<e.length;t++)this.use(e[t]);else if(typeof e==`function`)e(this);else throw TypeError(`plugin must be a Function or an Array of Functions`);return this},addRule:function(e,t){return this.rules.add(e,t),this},keep:function(e){return this.rules.keep(e),this},remove:function(e){return this.rules.remove(e),this},escape:function(e){return _(e)}};function U(e){var t=this;return V.call(e.childNodes,function(e,n){n=new I(n,t.options);var r=``;return n.nodeType===3?r=n.isCode?n.nodeValue:t.escape(n.nodeValue):n.nodeType===1&&(r=G.call(t,n)),K(e,r)},``)}function W(e){var t=this;return this.rules.forEach(function(n){typeof n.append==`function`&&(e=K(e,n.append(t.options)))}),e.replace(/^[\t\r\n]+/,``).replace(/[\t\r\n\s]+$/,``)}function G(e){var t=this.rules.forNode(e),n=U.call(this,e),r=e.flankingWhitespace;return(r.leading||r.trailing)&&(n=n.trim()),r.leading+t.replacement(n,e,this.options)+r.trailing}function K(e,t){var n=a(e),r=i(t),o=Math.max(e.length-n.length,t.length-r.length);return n+`

`.substring(0,o)+r}function q(e){return e!=null&&(typeof e==`string`||e.nodeType&&(e.nodeType===1||e.nodeType===9||e.nodeType===11))}e.setOptions({gfm:!0,breaks:!1});var J=new H({headingStyle:`atx`,codeBlockStyle:`fenced`,bulletListMarker:`-`});async function Y(t){let{text:n,setProgress:r}=t;r(`渲染 Markdown...`,``,30);let i=e.parse(n);return r(`完成`,``,100),{text:i,filename:`export.html`}}async function X(e){let{text:t,setProgress:n}=e;n(`转换 HTML...`,``,30);let r=J.turndown(t);return n(`完成`,``,100),{text:r,filename:`export.md`}}async function Z(n){let{text:r,setProgress:i}=n;i(`渲染 Markdown...`,``,20);let a=e.parse(r);i(`生成 PDF...`,``,50);let o=await t(a,`markdown_export`);return i(`完成`,``,100),[{blob:o,filename:`markdown_export.pdf`}]}async function Q(e){let{text:n,setProgress:r}=e;r(`生成 PDF...`,``,30);let i=await t(n,`html_export`);return r(`完成`,``,100),[{blob:i,filename:`html_export.pdf`}]}async function $(e){let{text:n,setProgress:r}=e;r(`构建 HTML...`,``,20);let i=`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, "Segoe UI", Roboto, "Microsoft YaHei", monospace; line-height: 1.5; margin: 0; padding: 16px; }
pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; margin: 0; }
</style>
</head>
<body>
<pre>${ne(n)}</pre>
</body>
</html>`;r(`生成 PDF...`,``,50);let a=await t(i,`text_export`);return r(`完成`,``,100),[{blob:a,filename:`text_export.pdf`}]}function ne(e){return String(e??``).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`)}var re={"md-to-html":Y,"html-to-md":X,"md-to-pdf":Z,"html-to-pdf":Q,"txt-to-pdf":$};export{re as HANDLERS,X as htmlToMd,Q as htmlToPdf,Y as mdToHtml,Z as mdToPdf,$ as txtToPdf};