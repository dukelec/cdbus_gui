/*
 * Software License Agreement (MIT License)
 *
 * Author: Duke Fong <d@d-l.io>
 */

import { trans_zh_tw }  from './trans/zh_tw.js?v=__V__'
import { trans_zh_cn }  from './trans/zh_cn.js?v=__V__'
//import { trans_ja }     from './trans/ja.js?v=__V__'
//import { trans_ko }     from './trans/ko.js?v=__V__'
//import { trans_de }     from './trans/de.js?v=__V__'

// the language picker offers these, '' means follow the browser
const LANGS = [['', 'Auto'], ['en', 'English'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文']];

// the lang item in localStorage wins over the browser language (picker in the nav bar)
function lang_pref() { try { return localStorage.getItem('lang') || ''; } catch { return ''; } }
function set_lang(v) { try { v ? localStorage.setItem('lang', v) : localStorage.removeItem('lang'); } catch {} }

const lang = lang_pref() || navigator.language;

// the language in use, configs key their "trans" by it; every traditional Chinese is zh-TW
let LANG = 'en';
let trans = null;
if (lang.startsWith('zh')) {
    [LANG, trans] = ['zh-TW', trans_zh_tw];
    if (lang.includes('CN') || lang.includes('Hans'))
        [LANG, trans] = ['zh-CN', trans_zh_cn];
}
//if (lang.startsWith('ja')) // Japanese
//    trans = trans_ja;
//if (lang.startsWith('ko')) // Korean
//    trans = trans_ko;
//if (lang.startsWith('de')) // German
//    trans = trans_de;

function L(ori, mark=null) {
    if (trans == null)
        return ori;
    if (!mark)
        mark = ori;
    return trans[mark] || ori;
}

export { L, LANG, LANGS, lang_pref, set_lang };
