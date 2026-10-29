import{t as e}from"./marked.esm-Ccg6WR5l.js";import{r as t,t as n}from"./document-D2JslslU.js";function r(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e}function i(e,t){return Array(t+1).join(e)}function a(e){return e.replace(/^\n*/,``)}function o(e){for(var t=e.length;t>0&&e[t-1]===`
`;)t--;return e.substring(0,t)}function s(e){return o(a(e))}var c=`ADDRESS.ARTICLE.ASIDE.AUDIO.BLOCKQUOTE.BODY.CANVAS.CENTER.DD.DIR.DIV.DL.DT.FIELDSET.FIGCAPTION.FIGURE.FOOTER.FORM.FRAMESET.H1.H2.H3.H4.H5.H6.HEADER.HGROUP.HR.HTML.ISINDEX.LI.MAIN.MENU.NAV.NOFRAMES.NOSCRIPT.OL.OUTPUT.P.PRE.SECTION.TABLE.TBODY.TD.TFOOT.TH.THEAD.TR.UL`.split(`.`);function l(e){return h(e,c)}var u=[`AREA`,`BASE`,`BR`,`COL`,`COMMAND`,`EMBED`,`HR`,`IMG`,`INPUT`,`KEYGEN`,`LINK`,`META`,`PARAM`,`SOURCE`,`TRACK`,`WBR`];function d(e){return h(e,u)}function f(e){return g(e,u)}var p=[`A`,`TABLE`,`THEAD`,`TBODY`,`TFOOT`,`TH`,`TD`,`IFRAME`,`SCRIPT`,`AUDIO`,`VIDEO`];function m(e){return h(e,p)}function ee(e){return g(e,p)}function h(e,t){return t.indexOf(e.nodeName)>=0}function g(e,t){return e.getElementsByTagName&&t.some(function(t){return e.getElementsByTagName(t).length})}var _=[[/\\/g,`\\\\`],[/\*/g,`\\*`],[/^-/g,`\\-`],[/^\+ /g,`\\+ `],[/^(=+)/g,`\\$1`],[/^(#{1,6}) /g,`\\$1 `],[/`/g,"\\`"],[/^~~~/g,`\\~~~`],[/\[/g,`\\[`],[/\]/g,`\\]`],[/^>/g,`\\>`],[/_/g,`\\_`],[/^(\d+)\. /g,`$1\\. `]];function v(e){return _.reduce(function(e,t){return e.replace(t[0],t[1])},e)}var y={};y.paragraph={filter:`p`,replacement:function(e){return`

`+e+`

`}},y.lineBreak={filter:`br`,replacement:function(e,t,n){return n.br+`
`}},y.heading={filter:[`h1`,`h2`,`h3`,`h4`,`h5`,`h6`],replacement:function(e,t,n){var r=Number(t.nodeName.charAt(1));if(n.headingStyle===`setext`&&r<3){var a=i(r===1?`=`:`-`,e.length);return`

`+e+`
`+a+`

`}else return`

`+i(`#`,r)+` `+e+`

`}},y.blockquote={filter:`blockquote`,replacement:function(e){return e=s(e).replace(/^/gm,`> `),`

`+e+`

`}},y.list={filter:[`ul`,`ol`],replacement:function(e,t){var n=t.parentNode;return n.nodeName===`LI`&&n.lastElementChild===t?`
`+e:`

`+e+`

`}},y.listItem={filter:`li`,replacement:function(e,t,n){var r=n.bulletListMarker+`   `,i=t.parentNode;if(i.nodeName===`OL`){var a=i.getAttribute(`start`),o=Array.prototype.indexOf.call(i.children,t);r=(a?Number(a)+o:o+1)+`.  `}var c=/\n$/.test(e);return e=s(e)+(c?`
`:``),e=e.replace(/\n/gm,`
`+` `.repeat(r.length)),r+e+(t.nextSibling?`
`:``)}},y.indentedCodeBlock={filter:function(e,t){return t.codeBlockStyle===`indented`&&e.nodeName===`PRE`&&e.firstChild&&e.firstChild.nodeName===`CODE`},replacement:function(e,t,n){return`

    `+t.firstChild.textContent.replace(/\n/g,`
    `)+`

`}},y.fencedCodeBlock={filter:function(e,t){return t.codeBlockStyle===`fenced`&&e.nodeName===`PRE`&&e.firstChild&&e.firstChild.nodeName===`CODE`},replacement:function(e,t,n){for(var r=((t.firstChild.getAttribute(`class`)||``).match(/language-(\S+)/)||[null,``])[1],a=t.firstChild.textContent,o=n.fence.charAt(0),s=3,c=RegExp(`^`+o+`{3,}`,`gm`),l;l=c.exec(a);)l[0].length>=s&&(s=l[0].length+1);var u=i(o,s);return`

`+u+r+`
`+a.replace(/\n$/,``)+`
`+u+`

`}},y.horizontalRule={filter:`hr`,replacement:function(e,t,n){return`

`+n.hr+`

`}},y.inlineLink={filter:function(e,t){return t.linkStyle===`inlined`&&e.nodeName===`A`&&e.getAttribute(`href`)},replacement:function(e,t){var n=x(t.getAttribute(`href`)),r=S(b(t.getAttribute(`title`))),i=r?` "`+r+`"`:``;return`[`+e+`](`+n+i+`)`}},y.referenceLink={filter:function(e,t){return t.linkStyle===`referenced`&&e.nodeName===`A`&&e.getAttribute(`href`)},replacement:function(e,t,n){var r=x(t.getAttribute(`href`)),i=b(t.getAttribute(`title`));i&&=` "`+S(i)+`"`;var a,o;switch(n.linkReferenceStyle){case`collapsed`:a=`[`+e+`][]`,o=`[`+e+`]: `+r+i;break;case`shortcut`:a=`[`+e+`]`,o=`[`+e+`]: `+r+i;break;default:var s=this.references.length+1;a=`[`+e+`][`+s+`]`,o=`[`+s+`]: `+r+i}return this.references.push(o),a},references:[],append:function(e){var t=``;return this.references.length&&(t=`

`+this.references.join(`
`)+`

`,this.references=[]),t}},y.emphasis={filter:[`em`,`i`],replacement:function(e,t,n){return e.trim()?n.emDelimiter+e+n.emDelimiter:``}},y.strong={filter:[`strong`,`b`],replacement:function(e,t,n){return e.trim()?n.strongDelimiter+e+n.strongDelimiter:``}},y.code={filter:function(e){var t=e.previousSibling||e.nextSibling,n=e.parentNode.nodeName===`PRE`&&!t;return e.nodeName===`CODE`&&!n},replacement:function(e){if(!e)return``;e=e.replace(/\r?\n|\r/g,` `);for(var t=/^`|^ .*?[^ ].* $|`$/.test(e)?` `:``,n="`",r=e.match(/`+/gm)||[];r.indexOf(n)!==-1;)n+="`";return n+t+e+t+n}},y.image={filter:`img`,replacement:function(e,t){var n=v(b(t.getAttribute(`alt`))),r=x(t.getAttribute(`src`)||``),i=b(t.getAttribute(`title`)),a=i?` "`+S(i)+`"`:``;return r?`![`+n+`](`+r+a+`)`:``}};function b(e){return e?e.replace(/(\n+\s*)+/g,`
`):``}function x(e){var t=e.replace(/([<>()])/g,`\\$1`);return t.indexOf(` `)>=0?`<`+t+`>`:t}function S(e){return e.replace(/"/g,`\\"`)}function C(e){for(var t in this.options=e,this._keep=[],this._remove=[],this.blankRule={replacement:e.blankReplacement},this.keepReplacement=e.keepReplacement,this.defaultRule={replacement:e.defaultReplacement},this.array=[],e.rules)this.array.push(e.rules[t])}C.prototype={add:function(e,t){this.array.unshift(t)},keep:function(e){this._keep.unshift({filter:e,replacement:this.keepReplacement})},remove:function(e){this._remove.unshift({filter:e,replacement:function(){return``}})},forNode:function(e){if(e.isBlank)return this.blankRule;var t;return(t=w(this.array,e,this.options))||(t=w(this._keep,e,this.options))||(t=w(this._remove,e,this.options))?t:this.defaultRule},forEach:function(e){for(var t=0;t<this.array.length;t++)e(this.array[t],t)}};function w(e,t,n){for(var r=0;r<e.length;r++){var i=e[r];if(T(i,t,n))return i}}function T(e,t,n){var r=e.filter;if(typeof r==`string`){if(r===t.nodeName.toLowerCase())return!0}else if(Array.isArray(r)){if(r.indexOf(t.nodeName.toLowerCase())>-1)return!0}else if(typeof r==`function`){if(r.call(e,t,n))return!0}else throw TypeError("`filter` needs to be a string, array, or function")}function E(e){var t=e.element,n=e.isBlock,r=e.isVoid,i=e.isPre||function(e){return e.nodeName===`PRE`};if(!(!t.firstChild||i(t))){for(var a=null,o=!1,s=null,c=O(s,t,i);c!==t;){if(c.nodeType===3||c.nodeType===4){var l=c.data.replace(/[ \r\n\t]+/g,` `);if((!a||/ $/.test(a.data))&&!o&&l[0]===` `&&(l=l.substr(1)),!l){c=D(c);continue}c.data=l,a=c}else if(c.nodeType===1)n(c)||c.nodeName===`BR`?(a&&(a.data=a.data.replace(/ $/,``)),a=null,o=!1):r(c)||i(c)?(a=null,o=!0):a&&(o=!1);else{c=D(c);continue}var u=O(s,c,i);s=c,c=u}a&&(a.data=a.data.replace(/ $/,``),a.data||D(a))}}function D(e){var t=e.nextSibling||e.parentNode;return e.parentNode.removeChild(e),t}function O(e,t,n){return e&&e.parentNode===t||n(t)?t.nextSibling||t.parentNode:t.firstChild||t.nextSibling||t.parentNode}var k=typeof window<`u`?window:{};function A(){var e=k.DOMParser,t=!1;try{new e().parseFromString(``,`text/html`)&&(t=!0)}catch{}return t}function te(){var e=function(){};return ne()?e.prototype.parseFromString=function(e){var t=new window.ActiveXObject(`htmlfile`);return t.designMode=`on`,t.open(),t.write(e),t.close(),t}:e.prototype.parseFromString=function(e){var t=document.implementation.createHTMLDocument(``);return t.open(),t.write(e),t.close(),t},e}function ne(){var e=!1;try{document.implementation.createHTMLDocument(``).open()}catch{k.ActiveXObject&&(e=!0)}return e}var re=A()?k.DOMParser:te();function j(e,t){var n=typeof e==`string`?N().parseFromString(`<x-turndown id="turndown-root">`+e+`</x-turndown>`,`text/html`).getElementById(`turndown-root`):e.cloneNode(!0);return E({element:n,isBlock:l,isVoid:d,isPre:t.preformattedCode?P:null}),n}var M;function N(){return M||=new re,M}function P(e){return e.nodeName===`PRE`||e.nodeName===`CODE`}function F(e,t){return e.isBlock=l(e),e.isCode=e.nodeName===`CODE`||e.parentNode.isCode,e.isBlank=I(e),e.flankingWhitespace=L(e,t),e}function I(e){return!d(e)&&!m(e)&&/^\s*$/i.test(e.textContent)&&!f(e)&&!ee(e)}function L(e,t){if(e.isBlock||t.preformattedCode&&e.isCode)return{leading:``,trailing:``};var n=R(e.textContent);return n.leadingAscii&&z(`left`,e,t)&&(n.leading=n.leadingNonAscii),n.trailingAscii&&z(`right`,e,t)&&(n.trailing=n.trailingNonAscii),{leading:n.leading,trailing:n.trailing}}function R(e){var t=e.match(/^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/);return{leading:t[1],leadingAscii:t[2],leadingNonAscii:t[3],trailing:t[4],trailingNonAscii:t[5],trailingAscii:t[6]}}function z(e,t,n){var r,i,a;return e===`left`?(r=t.previousSibling,i=/ $/):(r=t.nextSibling,i=/^ /),r&&(r.nodeType===3?a=i.test(r.nodeValue):n.preformattedCode&&r.nodeName===`CODE`?a=!1:r.nodeType===1&&!l(r)&&(a=i.test(r.textContent))),a}var B=Array.prototype.reduce;function V(e){if(!(this instanceof V))return new V(e);var t={rules:y,headingStyle:`setext`,hr:`* * *`,bulletListMarker:`*`,codeBlockStyle:`indented`,fence:"```",emDelimiter:`_`,strongDelimiter:`**`,linkStyle:`inlined`,linkReferenceStyle:`full`,br:`  `,preformattedCode:!1,blankReplacement:function(e,t){return t.isBlock?`

`:``},keepReplacement:function(e,t){return t.isBlock?`

`+t.outerHTML+`

`:t.outerHTML},defaultReplacement:function(e,t){return t.isBlock?`

`+e+`

`:e}};this.options=r({},t,e),this.rules=new C(this.options)}V.prototype={turndown:function(e){if(!K(e))throw TypeError(e+` is not a string, or an element/document/fragment node.`);if(e===``)return``;var t=H.call(this,new j(e,this.options));return U.call(this,t)},use:function(e){if(Array.isArray(e))for(var t=0;t<e.length;t++)this.use(e[t]);else if(typeof e==`function`)e(this);else throw TypeError(`plugin must be a Function or an Array of Functions`);return this},addRule:function(e,t){return this.rules.add(e,t),this},keep:function(e){return this.rules.keep(e),this},remove:function(e){return this.rules.remove(e),this},escape:function(e){return v(e)}};function H(e){var t=this;return B.call(e.childNodes,function(e,n){n=new F(n,t.options);var r=``;return n.nodeType===3?r=n.isCode?n.nodeValue:t.escape(n.nodeValue):n.nodeType===1&&(r=W.call(t,n)),G(e,r)},``)}function U(e){var t=this;return this.rules.forEach(function(n){typeof n.append==`function`&&(e=G(e,n.append(t.options)))}),e.replace(/^[\t\r\n]+/,``).replace(/[\t\r\n\s]+$/,``)}function W(e){var t=this.rules.forNode(e),n=H.call(this,e),r=e.flankingWhitespace;return(r.leading||r.trailing)&&(n=n.trim()),r.leading+t.replacement(n,e,this.options)+r.trailing}function G(e,t){var n=o(e),r=a(t),i=Math.max(e.length-n.length,t.length-r.length);return n+`

`.substring(0,i)+r}function K(e){return e!=null&&(typeof e==`string`||e.nodeType&&(e.nodeType===1||e.nodeType===9||e.nodeType===11))}e.setOptions({gfm:!0,breaks:!1});var q=new V({headingStyle:`atx`,codeBlockStyle:`fenced`,bulletListMarker:`-`});async function J(t){let{text:n,options:r,setProgress:i}=t;i(`渲染 Markdown...`,``,30);let a=e.parse(n);return i(`完成`,``,100),r[`md-full-doc`]?{text:Y(a,`Markdown Export`),filename:`export.html`}:{text:a,filename:`export.html`}}function Y(e,t){return`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; line-height: 1.6; max-width: 800px; margin: 2em auto; padding: 0 1em; color: #1f2937; }
h1 { font-size: 1.8em; margin: 0.6em 0 0.3em; }
h2 { font-size: 1.5em; margin: 0.6em 0 0.3em; }
h3 { font-size: 1.2em; margin: 0.6em 0 0.3em; }
p { margin: 0.6em 0; }
code { font-family: Consolas, monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
pre code { background: none; color: inherit; padding: 0; }
blockquote { border-left: 3px solid #6366f1; padding-left: 12px; color: #6b7280; margin: 0.6em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
th { background: #f1f5f9; }
img { max-width: 100%; }
a { color: #6366f1; }
</style>
</head>
<body>
${e}
</body>
</html>`}async function X(e){let{text:t,setProgress:n}=e;n(`转换 HTML...`,``,30);let r=q.turndown(t);return n(`完成`,``,100),{text:r,filename:`export.md`}}async function Z(n){let{text:r,setProgress:i}=n;i(`渲染 Markdown...`,``,20);let a=e.parse(r);i(`生成 PDF...`,``,50);let o=await t(a,`markdown_export`);return i(`完成`,``,100),[{blob:o,filename:`markdown_export.pdf`}]}async function Q(e){let{text:n,setProgress:r}=e;r(`生成 PDF...`,``,30);let i=await t(n,`html_export`);return r(`完成`,``,100),[{blob:i,filename:`html_export.pdf`}]}async function $(e){let{text:r,setProgress:i}=e;i(`构建 HTML...`,``,20);let a=`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, "Segoe UI", Roboto, "Microsoft YaHei", monospace; line-height: 1.5; margin: 0; padding: 16px; }
pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; margin: 0; }
</style>
</head>
<body>
<pre>${n(r)}</pre>
</body>
</html>`;i(`生成 PDF...`,``,50);let o=await t(a,`text_export`);return i(`完成`,``,100),[{blob:o,filename:`text_export.pdf`}]}var ie={"md-to-html":J,"html-to-md":X,"md-to-pdf":Z,"html-to-pdf":Q,"txt-to-pdf":$};export{ie as HANDLERS,X as htmlToMd,Q as htmlToPdf,J as mdToHtml,Z as mdToPdf,$ as txtToPdf};