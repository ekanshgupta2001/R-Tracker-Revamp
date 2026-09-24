// ── R-Tracker v2 — Java structure parser ─────────────────────────────────────
// Turns a student's Java source into a structural model the code checker can
// query: a token list, a tree of { } blocks classified by what opened them
// (class, method, if, while, lambda, …), statement ranges, and flat indexes of
// types, methods, fields, declarations, assignments, calls, conditions and
// `new` expressions, plus reachability from the OpMode entry points and a small
// bounded, name-based dataflow (flowsTo). It is tolerant: half-typed or broken
// code still yields a model plus diagnostics, and no input string makes it throw.
//
// HARD RULE: student code is never executed. This file only reads the text,
// character by character and token by token. Nothing is compiled or run.
//
// Conventions: ranges are token-index ranges { start, end } with `end`
// EXCLUSIVE; Block.open / Block.close are the token indexes of `{` and `}` (for
// a braceless body: its first and last token); lines and columns are 1-based.
//
// Exposes: window.RTJavaStructure = { VERSION, tokenize, parse, shingles, coverage }

(function () {
  'use strict';

  var VERSION = 'jstruct-1';
  var MAX_DIAGNOSTICS = 200;

  function wordSet(words) {
    var o = Object.create(null);
    words.split(/\s+/).forEach(function (w) { if (w) o[w] = true; });
    return o;
  }

  var KEYWORDS = wordSet('abstract assert boolean break byte case catch char class const continue default do double ' +
    'else enum extends final finally float for goto if implements import instanceof int interface long native new ' +
    'package private protected public return short static strictfp super switch synchronized this throw throws ' +
    'transient try void volatile while true false null');
  var CONTEXTUAL = wordSet('var record sealed permits yield');
  var PRIMITIVES = wordSet('boolean byte char short int long float double void');
  var MODIFIERS = wordSet('public private protected static final abstract native synchronized transient volatile strictfp default sealed');
  var OPS4 = wordSet('>>>=');
  var OPS3 = wordSet('>>> <<= >>= ...');
  var OPS2 = wordSet('-> :: == != <= >= && || ++ -- += -= *= /= %= &= |= ^= << >>');
  var OPS1 = '+-*/%=<>!~?:&|^';
  var PUNCT = '{}()[];,.';
  var ASSIGN_OPS = wordSet('= += -= *= /= %= &= |= ^= <<= >>= >>>=');
  var CMP_OPS = wordSet('== != < > <= >=');
  var GENERIC_KW = wordSet('extends super boolean byte char short int long float double void');
  var GENERIC_PREV_KW = wordSet('public private protected static final abstract synchronized native default');
  var CTRL_KW = wordSet('if while for switch catch synchronized try');
  var JUMP_KW = wordSet('return break continue throw');
  var ENTRY_NAMES = wordSet('runOpMode init init_loop start loop stop');
  var OPMODE_BASES = wordSet('LinearOpMode OpMode');
  var COND_BOUNDARY = wordSet('method ctor type anon init root');
  var IDENT_RE = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
  var NUMBER_RE = /(?:0[xX][0-9a-fA-F_]*(?:\.[0-9a-fA-F_]*)?(?:[pP][+-]?[0-9_]+)?|0[bB][01_]+|(?:[0-9][0-9_]*(?:\.(?!\.)[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9][0-9_]*)?)[lLfFdD]?/y;

  function pushDiag(list, kind, line, message) {
    if (list.length < MAX_DIAGNOSTICS) list.push({ kind: kind, line: line, message: message });
  }
  function isIdentLike(t) {
    return !!t && (t.type === 'ident' || (t.type === 'keyword' && t.contextual === true));
  }
  function isRegex(x) { return !!x && typeof x.test === 'function' && typeof x.source === 'string'; }
  function isP(t, v) { return !!t && t.type === 'punct' && t.value === v; }
  function isOp(t, v) { return !!t && t.type === 'op' && t.value === v; }
  function isKw(t, v) { return !!t && t.type === 'keyword' && t.value === v; }

  // ── Tokenizer ──────────────────────────────────────────────────────────────
  function unescapeAt(src, j) {
    var e = src.charAt(j + 1);
    if (e === '' || e === '\n') return { s: '\\', next: j + 1 };
    switch (e) {
      case 'n': return { s: '\n', next: j + 2 };
      case 't': return { s: '\t', next: j + 2 };
      case 'b': return { s: '\b', next: j + 2 };
      case 'r': return { s: '\r', next: j + 2 };
      case 'f': return { s: '\f', next: j + 2 };
      case 's': return { s: ' ', next: j + 2 };
      case 'u': {
        var m = /^u+([0-9a-fA-F]{4})/.exec(src.slice(j + 1, j + 12));
        if (m) return { s: String.fromCharCode(parseInt(m[1], 16)), next: j + 1 + m[0].length };
        return { s: 'u', next: j + 2 };
      }
      default:
        if (e >= '0' && e <= '7') {
          var o = /^[0-7]{1,3}/.exec(src.slice(j + 1, j + 4))[0];
          if (o.length === 3 && o.charAt(0) > '3') o = o.slice(0, 2);
          return { s: String.fromCharCode(parseInt(o, 8)), next: j + 1 + o.length };
        }
        return { s: e, next: j + 2 };
    }
  }

  function unescapeAll(s) {
    var out = '', i = 0;
    while (i < s.length) {
      if (s.charAt(i) === '\\') {
        if (s.charAt(i + 1) === '\n') { i += 2; continue; }        // text-block line continuation
        var r = unescapeAt(s, i); out += r.s; i = r.next;
      } else { out += s.charAt(i); i++; }
    }
    return out;
  }

  function textBlockValue(content) {
    var nl = content.indexOf('\n');
    var body = nl >= 0 ? content.slice(nl + 1) : '';
    var lines = body.split('\n').map(function (l) { return l.replace(/\r$/, ''); });
    var closingOwnLine = lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1]);
    var indent = Infinity;
    lines.forEach(function (l, k) {
      if (/^[ \t]*$/.test(l) && !(closingOwnLine && k === lines.length - 1)) return;
      var m = /^[ \t]*/.exec(l)[0].length;
      if (m < indent) indent = m;
    });
    if (indent === Infinity) indent = 0;
    var out = lines.map(function (l) { return l.slice(indent).replace(/[ \t]+$/, ''); });
    return unescapeAll(out.join('\n'));
  }

  function cleanBlockComment(body) {
    return body.split('\n').map(function (l) { return l.replace(/\r$/, '').replace(/^\s*\*(?!\/)\s?/, '').trim(); })
      .join('\n').trim();
  }

  function tokenizeInto(src, res) {
    res.src = src;
    var toks = res.tokens, comments = res.comments, diags = res.diagnostics;
    var n = src.length, i = 0, line = 1, lineStart = 0;

    function add(type, value, start, end, sLine, sCol) {
      var t = { i: toks.length, type: type, value: value, line: sLine, col: sCol, start: start, end: end, raw: src.slice(start, end) };
      toks.push(t);
      return t;
    }
    function advanceLines(from, to) {           // count newlines in src[from, to)
      for (var k = from; k < to; k++) if (src.charCodeAt(k) === 10) { line++; lineStart = k + 1; }
    }

    while (i < n) {
      var c = src.charCodeAt(i);
      if (c === 10) { line++; i++; lineStart = i; continue; }
      if (c === 32 || c === 9 || c === 13 || c === 12 || c === 11) { i++; continue; }
      if (c > 127 && /\s/.test(src.charAt(i))) { i++; continue; }
      var start = i, sLine = line, col = i - lineStart + 1;
      var d = i + 1 < n ? src.charCodeAt(i + 1) : 0;

      if (c === 47 && d === 47) {                                   // // line comment
        var le = src.indexOf('\n', i); if (le < 0) le = n;
        comments.push({ text: src.slice(i + 2, le).replace(/\r$/, '').trim(), line: line, endLine: line, kind: 'line',
          nextCodeLine: null, start: i, end: le, raw: src.slice(i, le) });
        i = le; continue;
      }
      if (c === 47 && d === 42) {                                   // /* block */ or /** doc */
        var ce = src.indexOf('*/', i + 2), terminated = ce >= 0;
        var end = terminated ? ce + 2 : n;
        var body = src.slice(i + 2, terminated ? ce : n);
        var isDoc = body.length > 1 && body.charAt(0) === '*';
        advanceLines(i, end);
        comments.push({ text: cleanBlockComment(isDoc ? body.slice(1) : body), line: sLine, endLine: line,
          kind: isDoc ? 'doc' : 'block', nextCodeLine: null, start: i, end: end, raw: src.slice(i, end) });
        if (!terminated) pushDiag(diags, 'unterminated-comment', sLine, 'Comment opened at line ' + sLine + ' is never closed with */');
        i = end; continue;
      }
      if (c === 34) {                                               // "string" or """text block"""
        if (d === 34 && src.charCodeAt(i + 2) === 34) {
          var j = i + 3, found = -1;
          while (j < n) {
            if (src.charCodeAt(j) === 92) { j += 2; continue; }
            if (src.charCodeAt(j) === 34 && src.charCodeAt(j + 1) === 34 && src.charCodeAt(j + 2) === 34) { found = j; break; }
            j++;
          }
          var tbEnd = found >= 0 ? found + 3 : n;
          var tb = add('string', textBlockValue(src.slice(i + 3, found >= 0 ? found : n)), i, tbEnd, sLine, col);
          tb.textBlock = true;
          advanceLines(i, tbEnd);
          if (found < 0) pushDiag(diags, 'unterminated-string', sLine, 'Text block opened at line ' + sLine + ' is never closed');
          i = tbEnd; continue;
        }
        var k = i + 1, val = '', closed = false;
        while (k < n) {
          var ch = src.charCodeAt(k);
          if (ch === 34) { closed = true; k++; break; }
          if (ch === 10) break;
          if (ch === 92) { var r = unescapeAt(src, k); val += r.s; k = r.next; continue; }
          val += src.charAt(k); k++;
        }
        var st = add('string', val, i, k, sLine, col);
        if (!closed) { st.unterminated = true; pushDiag(diags, 'unterminated-string', sLine, 'String at line ' + sLine + ' is missing its closing quote'); }
        i = k; continue;
      }
      if (c === 39) {                                               // 'c' char literal
        var q = i + 1, cv = '';
        if (src.charCodeAt(q) === 92) { var ru = unescapeAt(src, q); cv = ru.s; q = ru.next; }
        else if (q < n && src.charCodeAt(q) !== 10 && src.charCodeAt(q) !== 39) {
          var cp = src.codePointAt(q); cv = String.fromCodePoint(cp); q += cp > 0xFFFF ? 2 : 1;
        }
        var okChar = src.charCodeAt(q) === 39;
        if (okChar) q++;
        else {
          var qn = src.indexOf("'", q), nl = src.indexOf('\n', q);
          if (qn >= 0 && (nl < 0 || qn < nl) && qn - q < 8) { cv += src.slice(q, qn); q = qn + 1; }
          pushDiag(diags, 'unterminated-string', sLine, 'Character literal at line ' + sLine + ' is not closed');
        }
        add('char', cv, i, q, sLine, col);
        i = q; continue;
      }
      if ((c >= 48 && c <= 57) || (c === 46 && d >= 48 && d <= 57)) { // number
        NUMBER_RE.lastIndex = i;
        var nm = NUMBER_RE.exec(src);
        var nlen = nm && nm[0].length ? nm[0].length : 1;
        add('number', src.slice(i, i + nlen), i, i + nlen, sLine, col);
        i += nlen; continue;
      }
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127) { // identifier / keyword
        IDENT_RE.lastIndex = i;
        var im = IDENT_RE.exec(src);
        if (im) {
          var w = im[0];
          var it = add(KEYWORDS[w] || CONTEXTUAL[w] ? 'keyword' : 'ident', w, i, i + w.length, sLine, col);
          if (CONTEXTUAL[w]) it.contextual = true;
          i += w.length; continue;
        }
      }
      if (c === 64) {                                               // @Annotation
        IDENT_RE.lastIndex = i + 1;
        var am = IDENT_RE.exec(src);
        if (am) {
          var aname = am[0], ae = i + 1 + aname.length;
          while (src.charCodeAt(ae) === 46) {
            IDENT_RE.lastIndex = ae + 1;
            var am2 = IDENT_RE.exec(src);
            if (!am2) break;
            aname += '.' + am2[0]; ae += 1 + am2[0].length;
          }
          var at = add('annotation', '@' + aname, i, ae, sLine, col);
          at.name = aname.split('.').pop();
          i = ae; continue;
        }
      }
      var s4 = src.substr(i, 4), s3 = src.substr(i, 3), s2 = src.substr(i, 2), s1 = src.charAt(i);
      if (OPS4[s4]) { add('op', s4, i, i + 4, sLine, col); i += 4; continue; }
      if (OPS3[s3]) { add('op', s3, i, i + 3, sLine, col); i += 3; continue; }
      if (OPS2[s2]) { add('op', s2, i, i + 2, sLine, col); i += 2; continue; }
      if (PUNCT.indexOf(s1) >= 0) { add('punct', s1, i, i + 1, sLine, col); i += 1; continue; }
      if (OPS1.indexOf(s1) >= 0 || s1 === '@') { add('op', s1, i, i + 1, sLine, col); i += 1; continue; }
      var ucp = src.codePointAt(i);
      pushDiag(diags, 'unknown-char', sLine, 'Unexpected character ' + JSON.stringify(String.fromCodePoint(ucp)) + ' at line ' + sLine);
      i += ucp > 0xFFFF ? 2 : 1;
    }
    toks.push({ i: toks.length, type: 'eof', value: '', line: line, col: n - lineStart + 1, start: n, end: n, raw: '' });

    // Link each comment to the code around it.
    var ti = 0;
    for (var ci = 0; ci < comments.length; ci++) {
      var cm = comments[ci];
      while (toks[ti].type !== 'eof' && toks[ti].start < cm.end) ti++;
      cm.nextCodeLine = toks[ti].type === 'eof' ? null : toks[ti].line;
      var pt = ti > 0 ? toks[ti - 1] : null;
      cm.prevCodeLine = pt && pt.end <= cm.start ? pt.line : null;
      cm.trailing = !!(pt && pt.end <= cm.start && pt.line === cm.line);
    }
  }

  function tokenize(src) {
    var res = { tokens: [], comments: [], diagnostics: [], src: '' };
    try {
      tokenizeInto(typeof src === 'string' ? src : String(src == null ? '' : src), res);
    } catch (e) {
      pushDiag(res.diagnostics, 'internal', 0, 'Tokenizer error: ' + (e && e.message ? e.message : String(e)));
      var last = res.tokens[res.tokens.length - 1];
      if (!last || last.type !== 'eof') res.tokens.push({ i: res.tokens.length, type: 'eof', value: '', line: 1, col: 1, start: res.src.length, end: res.src.length, raw: '' });
    }
    return res;
  }

  // ── Text helpers ───────────────────────────────────────────────────────────
  function tokText(t) { return t.type === 'string' || t.type === 'char' ? t.raw : t.value; }
  function isWordy(t) { return t.type === 'ident' || t.type === 'keyword' || t.type === 'number' || t.type === 'string' || t.type === 'char' || t.type === 'annotation'; }

  function makeTextFns(toks, flags) {
    function spaced(s, e) {                       // tokens joined with single spaces
      var out = [];
      for (var i = s; i < e && i < toks.length; i++) if (toks[i].type !== 'eof') out.push(tokText(toks[i]));
      return out.join(' ');
    }
    function compact(s, e) {                      // readable source-like text
      var out = '', prev = null, prevUnary = false;
      for (var i = s; i < e && i < toks.length; i++) {
        var t = toks[i];
        if (t.type === 'eof') break;
        var v = tokText(t), sp = true;
        if (!prev) sp = false;
        else {
          var a = prev.value, b = t.value, aP = prev.type === 'punct', bP = t.type === 'punct';
          var aGen = flags.gen[i - 1] === 1, bGen = flags.gen[i] === 1;
          if (bP && (b === '.' || b === ')' || b === ']' || b === ',' || b === ';' || b === '[')) sp = false;
          else if (bP && b === '(') sp = prev.type === 'keyword' && CTRL_KW[a] === true;
          else if (aP && (a === '.' || a === '(' || a === '[')) sp = false;
          else if (a === '::' || b === '::') sp = false;
          else if (bGen && (b === '<' || b.charAt(0) === '>')) sp = false;
          else if (aGen && a === '<') sp = false;
          else if (prev.type === 'op' && (a === '!' || a === '~')) sp = false;
          else if (prev.type === 'op' && (a === '++' || a === '--') && isWordy(t)) sp = false;
          else if (t.type === 'op' && (b === '++' || b === '--') && (isWordy(prev) || a === ')' || a === ']')) sp = false;
          else if (prevUnary) sp = false;
        }
        var unary = false;
        if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
          unary = !prev || (prev.type === 'op' && flags.gen[i - 1] !== 1) || (prev.type === 'punct' && (prev.value === '(' || prev.value === ',' || prev.value === '[' || prev.value === '{')) || isKw(prev, 'return');
        }
        out += (sp ? ' ' : '') + v;
        prev = t; prevUnary = unary;
      }
      return out;
    }
    return { spaced: spaced, compact: compact };
  }

  // ── Pair matching and generic marking ──────────────────────────────────────
  function matchPairs(toks, n) {
    var match = new Int32Array(n + 1).fill(-1), stack = [];
    for (var i = 0; i < n; i++) {
      var t = toks[i];
      if (t.type !== 'punct') continue;
      var v = t.value;
      if (v === '(' || v === '[' || v === '{') { stack.push(i); continue; }
      var want = v === ')' ? '(' : v === ']' ? '[' : v === '}' ? '{' : null;
      if (!want) continue;
      for (var k = stack.length - 1; k >= 0; k--) {
        var o = toks[stack[k]].value;
        if (o === want) { match[i] = stack[k]; match[stack[k]] = i; stack.length = k; break; }
        if (o === '{' && want !== '{') break;           // ) and ] never close across a brace
      }
    }
    return match;
  }

  function markGenerics(toks, n, gen) {
    for (var i = 1; i < n; i++) {
      var t = toks[i];
      if (t.type !== 'op' || t.value !== '<' || gen[i]) continue;
      var p = toks[i - 1];
      var okPrev = isIdentLike(p) || isOp(p, '?') || (p.type === 'op' && p.value.charAt(0) === '>' && gen[i - 1] === 1) ||
        isP(p, ',') || isP(p, '.') || (p.type === 'keyword' && GENERIC_PREV_KW[p.value] === true);
      if (!okPrev) continue;
      var depth = 0, close = -1, lim = Math.min(n, i + 200);
      for (var j = i; j < lim; j++) {
        var u = toks[j], v = u.value;
        if (u.type === 'op') {
          if (v === '<') depth++;
          else if (v === '>') depth--;
          else if (v === '>>') depth -= 2;
          else if (v === '>>>') depth -= 3;
          else if (v !== '?' && v !== '&') break;
          if (depth <= 0) { close = j; break; }
        } else if (u.type === 'ident' || u.type === 'annotation' || (u.type === 'keyword' && GENERIC_KW[v] === true)) {
          continue;
        } else if (u.type === 'punct' && (v === '.' || v === ',' || v === '[' || v === ']')) {
          continue;
        } else break;
      }
      if (close < 0 || depth < 0) continue;
      for (var m = i; m <= close; m++) {
        var w = toks[m];
        if (w.type === 'op' && (w.value === '<' || w.value.charAt(0) === '>') && w.value.indexOf('=') < 0) gen[m] = 1;
      }
    }
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  function parse(input) {
    var M = {
      ok: false, version: VERSION, diagnostics: [], tokens: [], comments: [], src: '',
      types: [], methods: [], fields: [], decls: [], assigns: [], calls: [], conds: [], news: [], blocks: [],
      statements: [], cases: [], methodRefs: [], imports: [], staticImports: [], lineCount: 0
    };
    var S = { model: M };
    installApi(M, S);
    try {
      build(M, S, input);
      M.ok = !M.diagnostics.some(function (d) {
        return d.kind === 'internal' || d.kind === 'unbalanced-brace' || d.kind === 'unterminated-string' || d.kind === 'unterminated-comment';
      });
    } catch (e) {
      M.ok = false;
      M.diagnostics.push({ kind: 'internal', line: 0, message: 'Parser error: ' + (e && e.message ? e.message : String(e)) });
    }
    return M;
  }

  function build(M, S, input) {
    // 1. Tokens
    var lex;
    if (typeof input === 'string' || input == null) lex = tokenize(input == null ? '' : input);
    else if (Array.isArray(input)) lex = { tokens: input.slice(), comments: [], diagnostics: [], src: null };
    else if (typeof input === 'object' && Array.isArray(input.tokens)) lex = { tokens: input.tokens.slice(), comments: input.comments || [], diagnostics: (input.diagnostics || []).slice(), src: typeof input.src === 'string' ? input.src : null };
    else lex = tokenize(String(input));
    var toks = lex.tokens;
    if (!toks.length || toks[toks.length - 1].type !== 'eof') {
      var lt = toks[toks.length - 1];
      toks.push({ i: toks.length, type: 'eof', value: '', line: lt ? lt.line : 1, col: 1, start: lt ? lt.end : 0, end: lt ? lt.end : 0, raw: '' });
    }
    var n = toks.length - 1;
    M.tokens = toks; M.comments = lex.comments; M.diagnostics = lex.diagnostics;
    M.src = lex.src;
    var lines = lex.src != null ? lex.src.split('\n') : null;
    S.lines = lines;
    M.lineCount = lex.src != null ? (lex.src === '' ? 0 : lines.length) : (n ? toks[n - 1].line : 0);

    var flags = { gen: new Uint8Array(n + 1), anno: new Uint8Array(n + 1), declEq: new Uint8Array(n + 1), notCall: new Uint8Array(n + 1), caseArrow: new Uint8Array(n + 1) };
    S.toks = toks; S.n = n; S.flags = flags;
    var match = matchPairs(toks, n);
    S.match = match;
    markGenerics(toks, n, flags.gen);
    var TX = makeTextFns(toks, flags);
    S.TX = TX;
    for (var ai = 0; ai < n; ai++) {                               // annotation arguments are not code
      if (toks[ai].type === 'annotation' && isP(toks[ai + 1], '(') && match[ai + 1] > ai) {
        for (var ak = ai + 1; ak <= match[ai + 1]; ak++) flags.anno[ak] = 1;
      }
    }

    blockPass(M, S);
    exprLambdas(M, S);
    paint(M, S);
    typesAndMethods(M, S);
    importsPass(M, S);
    declsPass(M, S);
    callsPass(M, S);
    statementKinds(M, S);
    assignsPass(M, S);
    condsPass(M, S);
    loopsPass(M, S);
    deadPass(M, S);
    reachPass(M, S);
    contextPass(M, S);
  }

  // ── Block pass: { } tree, braceless bodies, statements ────────────────────
  function blockPass(M, S) {
    var toks = S.toks, n = S.n, match = S.match, flags = S.flags;
    var blocks = M.blocks, statements = M.statements, diags = M.diagnostics;

    function newBlock(kind, open) {
      var b = { nodeType: 'block', id: blocks.length, kind: kind, open: open, close: -1, line: 0, endLine: 0, parent: null,
        children: [], header: { start: open, end: open }, cond: null, loop: false, dead: false, statements: [],
        typeRef: null, methodRef: null, elseOf: null, braceless: false, exprBlock: false, iterates: false,
        caseCond: null, depth: 0, ownerStmt: null, argOf: null, argIndex: -1, parenOpen: -1, parenClose: -1, unclosed: false };
      blocks.push(b);
      return b;
    }
    var root = newBlock('root', -1);
    root.close = n; root.header = { start: 0, end: 0 };
    S.root = root;

    function frame(b) {
      return { block: b, parens: 0, brackets: 0, stmtStart: -1, children: [], pendingDo: null, lastBlock: null, curCase: null,
        enumPhase: b.kind === 'type' && b.typeKind === 'enum' };
    }
    var stack = [frame(root)];
    function top() { return stack[stack.length - 1]; }
    function isTypeBody(b) { return b.kind === 'type' || b.kind === 'anon' || b.kind === 'root'; }

    function endStatement(f, endIdx, lb) {
      if (f.stmtStart < 0 || endIdx < f.stmtStart) { f.stmtStart = -1; f.lastBlock = lb || null; return; }
      var first = toks[f.stmtStart];
      if (f.block.kind !== 'array') {
        var st = { nodeType: 'statement', id: statements.length, kind: null, start: f.stmtStart, end: endIdx + 1, line: first.line,
          block: f.block, headerOf: lb || f.pendingDo || null, childBlocks: f.children, caseCond: f.block.kind === 'switch' ? f.curCase : null,
          dead: false, enumConstants: f.enumPhase };
        statements.push(st); f.block.statements.push(st);
      }
      if (f.enumPhase) f.enumPhase = false;
      f.stmtStart = -1; f.parens = 0; f.brackets = 0; f.children = []; f.pendingDo = null;
      f.lastBlock = lb || null;
      if (f.block.braceless && top() === f) {
        var nx = toks[endIdx + 1];
        if (isKw(nx, 'else') && (isKw(first, 'if') || isKw(first, 'else')) && f.block.kind !== 'else') return;
        closeSynthetic(f, endIdx);
      }
    }

    function closeSynthetic(f, endIdx) {
      var b = f.block;
      b.close = Math.max(endIdx, b.open);
      if (b.close < b.open) b.close = b.open;
      stack.pop();
      var p = top();
      p.children.push(b);
      if (b.kind === 'do') { p.pendingDo = b; return; }
      endStatement(p, endIdx, b);
    }

    function pushSynthetic(kind, openIdx, header, parenOpen, parenClose, elseChain) {
      var f = top();
      var b = newBlock(kind, openIdx);
      b.braceless = true; b.header = header; b.parenOpen = parenOpen; b.parenClose = parenClose;
      b.parent = f.block;
      if (f.block.kind === 'switch') b.caseCond = f.curCase;
      if (kind === 'else' || elseChain) linkElse(f, b);
      stack.push(frame(b));
    }

    function linkElse(f, b) {
      var lb = f.lastBlock;
      if (lb && (lb.kind === 'if') ) { b.elseOf = lb; lb.elseBlock = b; }
    }

    function isForeachHeader(o, c) {
      var depth = 0;
      for (var k = o + 1; k < c; k++) {
        var t = toks[k];
        if (t.type === 'punct') {
          if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
          else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
          else if (t.value === ';' && depth === 0) return false;
        } else if (depth === 0 && isOp(t, ':')) return true;
      }
      return false;
    }

    function afterHeaderParen(f, closeIdx) {
      var o = match[closeIdx];
      if (o < 0) return;
      if (f.pendingDo && isKw(toks[o - 1], 'while')) {
        f.pendingDo.parenOpen = o; f.pendingDo.parenClose = closeIdx; f.pendingDo.tailWhile = o - 1;
        return;
      }
      var s = f.stmtStart, k = s, elseChain = false;
      if (isKw(toks[s], 'else') && isKw(toks[s + 1], 'if')) { k = s + 1; elseChain = true; }
      var kw = toks[k];
      if (!(isKw(kw, 'if') || isKw(kw, 'while') || isKw(kw, 'for'))) return;
      if (k + 1 !== o) return;
      if (isP(toks[closeIdx + 1], '{')) return;
      var kind = kw.value;
      if (kind === 'for' && isForeachHeader(o, closeIdx)) kind = 'foreach';
      pushSynthetic(kind, closeIdx + 1, { start: s, end: closeIdx + 1 }, o, closeIdx, elseChain);
    }

    function headerHasTypeKw(s, e) {
      var depth = 0;
      for (var k = s; k < e; k++) {
        var t = toks[k];
        if (t.type === 'punct' && (t.value === '(' || t.value === '[')) depth++;
        else if (t.type === 'punct' && (t.value === ')' || t.value === ']')) depth--;
        else if (depth === 0) {
          if (t.type === 'keyword' && (t.value === 'class' || t.value === 'interface' || t.value === 'enum') && !isP(toks[k - 1], '.')) return t.value;
          if (t.type === 'annotation' && t.value === '@interface') return 'interface';
          if (isKw(t, 'record') && isIdentLike(toks[k + 1]) && k + 1 < e) return 'record';
        }
      }
      return null;
    }

    function classify(f, i) {
      var prev = toks[i - 1], s = f.stmtStart, fb = f.block;
      var inParens = f.parens > 0 || f.brackets > 0;
      var r = { kind: 'plain', header: { start: s, end: i }, expr: inParens, parenOpen: -1, parenClose: -1 };
      if (prev && isOp(prev, '->') && i - 1 >= s) {
        if (flags.caseArrow[i - 1]) { r.header = { start: i, end: i }; return r; }
        var hs = isP(toks[i - 2], ')') && match[i - 2] >= 0 ? match[i - 2] : i - 2;
        return { kind: 'lambda', header: { start: Math.max(hs, 0), end: i }, expr: true, parenOpen: -1, parenClose: -1 };
      }
      if (prev && (isP(prev, ',') || isP(prev, '{')) && fb.kind === 'array') {
        return { kind: 'array', header: { start: i, end: i }, expr: true, parenOpen: -1, parenClose: -1 };
      }
      if (prev && i - 1 >= s && (isP(prev, ']') || isOp(prev, '=') || isP(prev, '('))) {
        return { kind: 'array', header: { start: i, end: i }, expr: true, parenOpen: -1, parenClose: -1 };
      }
      if (s === i || !prev) {
        r.kind = fb.kind === 'type' || fb.kind === 'anon' ? 'init' : 'plain';
        r.header = { start: i, end: i };
        return r;
      }
      if (isP(prev, ')') && match[i - 1] >= 0) {
        var o = match[i - 1], b = toks[o - 1];
        if (b && b.type === 'keyword' && CTRL_KW[b.value]) {
          var kind = b.value;
          if (kind === 'for' && isForeachHeader(o, i - 1)) kind = 'foreach';
          var startsWithKw = s === o - 1 || (isKw(toks[s], 'else') && s + 1 === o - 1);
          return { kind: kind, header: { start: s, end: i }, expr: inParens || !startsWithKw, parenOpen: o, parenClose: i - 1 };
        }
        var tk = headerHasTypeKw(s, o);
        if (tk) return { kind: 'type', typeKind: tk, header: { start: s, end: i }, expr: inParens, parenOpen: -1, parenClose: -1 };
        if (b && (isIdentLike(b) || (b.type === 'op' && b.value.charAt(0) === '>' && flags.gen[o - 1]))) {
          var q = o - 1;
          if (!isIdentLike(b)) {                                    // skip explicit type arguments back to the name
            var depth = 0;
            for (; q > s; q--) {
              var gv = toks[q];
              if (flags.gen[q] && gv.value.charAt(0) === '>') depth += gv.value.length;
              else if (flags.gen[q] && gv.value === '<') { depth--; if (depth <= 0) { q--; break; } }
            }
          }
          while (q - 2 >= 0 && isP(toks[q - 1], '.') && isIdentLike(toks[q - 2])) q -= 2;
          if (isKw(toks[q - 1], 'new')) return { kind: 'anon', header: { start: q - 1, end: i }, expr: true, parenOpen: o, parenClose: i - 1, newIdx: q - 1 };
          if (f.enumPhase) return { kind: 'anon', header: { start: s, end: i }, expr: true, parenOpen: o, parenClose: i - 1, enumConst: true };
          if (isTypeBody(fb) && isIdentLike(b)) return { kind: 'method', header: { start: s, end: i }, expr: false, parenOpen: o, parenClose: i - 1, nameIdx: o - 1 };
        }
        return r;
      }
      if (prev.type === 'keyword' && !prev.contextual) {
        var pv = prev.value;
        if (pv === 'else') r.kind = 'else';
        else if (pv === 'try') r.kind = 'try';
        else if (pv === 'finally') r.kind = 'finally';
        else if (pv === 'do') r.kind = 'do';
        else if (pv === 'static' && isTypeBody(fb)) r.kind = 'init';
        return r;
      }
      var tk2 = headerHasTypeKw(s, i);
      if (tk2) return { kind: 'type', typeKind: tk2, header: { start: s, end: i }, expr: inParens, parenOpen: -1, parenClose: -1 };
      if (f.enumPhase) return { kind: 'anon', header: { start: s, end: i }, expr: true, parenOpen: -1, parenClose: -1, enumConst: true };
      if (isTypeBody(fb)) {
        var depth2 = 0;
        for (var k = s; k < i; k++) {
          var tt = toks[k];
          if (isP(tt, '(')) depth2++;
          else if (isP(tt, ')')) depth2--;
          else if (depth2 === 0 && isKw(tt, 'throws') && isP(toks[k - 1], ')') && match[k - 1] >= 0) {
            return { kind: 'method', header: { start: s, end: i }, expr: false, parenOpen: match[k - 1], parenClose: k - 1, nameIdx: match[k - 1] - 1 };
          }
        }
        if (isIdentLike(prev) && fb.kind === 'type' && fb.typeKind === 'record') {
          return { kind: 'method', header: { start: s, end: i }, expr: false, parenOpen: -1, parenClose: -1, nameIdx: i - 1, compact: true };
        }
        if (fb.kind !== 'root') r.kind = 'init';
      }
      return r;
    }

    function openBrace(i) {
      var f = top();
      var c = classify(f, i);
      var b = newBlock(c.kind, i);
      b.header = c.header; b.exprBlock = !!c.expr; b.parenOpen = c.parenOpen; b.parenClose = c.parenClose;
      if (c.typeKind) b.typeKind = c.typeKind;
      if (c.nameIdx != null) b.nameIdx = c.nameIdx;
      if (c.newIdx != null) b.newIdx = c.newIdx;
      if (c.enumConst) b.enumConst = true;
      if (c.compact) b.compactCtor = true;
      b.parent = f.block;
      if (f.block.kind === 'switch' && !b.exprBlock) b.caseCond = f.curCase;
      if (b.kind === 'else' || (b.kind === 'if' && isKw(toks[f.stmtStart], 'else'))) linkElse(f, b);
      f.children.push(b);
      stack.push(frame(b));
    }

    function closeBrace(i) {
      var guard = 0;
      while (stack.length > 1 && top().block.braceless && guard++ < 100000) {
        var sf = top();
        if (sf.stmtStart >= 0) endStatement(sf, i - 1);
        if (top() === sf) closeSynthetic(sf, i - 1);
      }
      if (stack.length === 1) {
        pushDiag(diags, 'unbalanced-brace', toks[i].line, "Unmatched '}' at line " + toks[i].line);
        return;
      }
      var f = top();
      if (f.stmtStart >= 0 && f.stmtStart <= i - 1) endStatement(f, i - 1);
      f.block.close = i;
      stack.pop();
      var p = top();
      if (f.block.exprBlock) return;
      if (f.block.kind === 'do') { p.pendingDo = f.block; return; }
      endStatement(p, i, f.block);
    }

    function isHeaderWithSemis(f) {
      var s = f.stmtStart, t = toks[s];
      if (isKw(t, 'else')) t = toks[s + 1];
      return isKw(t, 'for') || isKw(t, 'try');
    }

    function endLabel(f, i, isCase) {
      var st = { nodeType: 'statement', id: statements.length, kind: 'label', start: f.stmtStart, end: i + 1, line: toks[f.stmtStart].line,
        block: f.block, headerOf: null, childBlocks: f.children, caseCond: null, dead: false, enumConstants: false };
      if (isCase) {
        var labels = [], ls = f.stmtStart + 1, depth = 0;
        for (var k = ls; k <= i; k++) {
          var t = toks[k];
          if (t.type === 'punct' && (t.value === '(' || t.value === '[')) depth++;
          else if (t.type === 'punct' && (t.value === ')' || t.value === ']')) depth--;
          if (k === i || (depth === 0 && isP(t, ','))) {
            if (k > ls) labels.push(S.TX.compact(ls, k));
            ls = k + 1;
          }
        }
        var isDefault = isKw(toks[f.stmtStart], 'default');
        var cc = { nodeType: 'cond', id: -1, block: f.block, start: f.stmtStart, end: i, line: st.line,
          text: S.TX.compact(f.stmtStart, i), labels: isDefault ? [] : labels, isDefault: isDefault, caseLabel: true,
          hasComparison: false, constantFalse: false, constantTrue: false, negated: false, dead: false, reachable: false, live: false };
        var prevSt = f.block.statements[f.block.statements.length - 1];
        if (prevSt && prevSt.isCase && prevSt.end === f.stmtStart && prevSt.caseCond) {   // case 1: case 2: (fall-through group)
          cc.labels = prevSt.caseCond.labels.concat(cc.labels);
          cc.isDefault = cc.isDefault || prevSt.caseCond.isDefault;
          cc.text = prevSt.caseCond.text + ' ' + cc.text;
        }
        st.caseCond = cc; st.isCase = true;
        f.curCase = cc;
        M.cases.push(cc);
      }
      statements.push(st); f.block.statements.push(st);
      f.stmtStart = -1; f.parens = 0; f.brackets = 0; f.children = []; f.lastBlock = null;
    }

    for (var i = 0; i < n; i++) {
      var t = toks[i], f = top(), v = t.value, ty = t.type;
      if (ty === 'punct' && v === '}') { closeBrace(i); continue; }
      if (ty === 'punct' && v === '{') { if (f.stmtStart < 0) f.stmtStart = i; openBrace(i); continue; }
      if (f.stmtStart < 0) {
        if (ty === 'punct' && v === ';') {                          // empty statement
          if (f.enumPhase) f.enumPhase = false;
          if (f.block.braceless) closeSynthetic(f, i);
          continue;
        }
        f.stmtStart = i;
        if (ty === 'keyword' && (v === 'else' || v === 'do')) {
          var nx = toks[i + 1];
          if (!isP(nx, '{') && !(v === 'else' && isKw(nx, 'if')) && nx.type !== 'eof') {
            pushSynthetic(v, i + 1, { start: i, end: i + 1 }, -1, -1, false);
            continue;
          }
        }
      }
      if (ty === 'punct') {
        if (v === '(') f.parens++;
        else if (v === ')') { if (f.parens > 0) { f.parens--; if (f.parens === 0 && f.brackets === 0) afterHeaderParen(f, i); } }
        else if (v === '[') f.brackets++;
        else if (v === ']') { if (f.brackets > 0) f.brackets--; }
        else if (v === ';') {
          if ((f.parens === 0 && f.brackets === 0) || !isHeaderWithSemis(f)) endStatement(f, i);
        }
      } else if (ty === 'op' && (v === ':' || v === '->') && f.parens === 0 && f.brackets === 0) {
        var s0 = toks[f.stmtStart];
        if ((isKw(s0, 'case') || isKw(s0, 'default')) && f.block.kind === 'switch') {
          if (v === '->') flags.caseArrow[i] = 1;
          endLabel(f, i, true);
        } else if (v === ':' && i === f.stmtStart + 1 && isIdentLike(s0) && f.block.kind !== 'root') {
          endLabel(f, i, false);
        }
      }
    }
    // End of input: close whatever is still open.
    var guard = 0;
    while (stack.length > 1 && guard++ < 1000000) {
      var ef = top();
      if (ef.block.braceless) {
        if (ef.stmtStart >= 0) endStatement(ef, n - 1);
        if (top() === ef) closeSynthetic(ef, Math.max(n - 1, ef.block.open));
        continue;
      }
      pushDiag(diags, 'unbalanced-brace', toks[ef.block.open].line, "'{' opened at line " + toks[ef.block.open].line + ' is never closed');
      if (ef.stmtStart >= 0) endStatement(ef, n - 1);
      ef.block.close = n; ef.block.unclosed = true;
      stack.pop();
      var ep = top();
      if (!ef.block.exprBlock && ef.block.kind !== 'do') endStatement(ep, n - 1, ef.block);
      else if (ef.block.kind === 'do') ep.pendingDo = ef.block;
    }
    if (stack[0].stmtStart >= 0) endStatement(stack[0], n - 1);
  }

  // Expression-bodied lambdas (`x -> a(x)`) get a synthetic block holding one statement.
  function exprLambdas(M, S) {
    var toks = S.toks, n = S.n, match = S.match, flags = S.flags;
    for (var i = 0; i < n; i++) {
      var t = toks[i];
      if (t.type !== 'op' || t.value !== '->' || flags.caseArrow[i] || isP(toks[i + 1], '{')) continue;
      var s = i + 1, p = s, depth = 0;
      while (p < n) {
        var u = toks[p];
        if (u.type === 'punct') {
          var v = u.value;
          if (v === '(' || v === '[' || v === '{') depth++;
          else if (v === ')' || v === ']' || v === '}') { if (depth === 0) break; depth--; }
          else if (depth === 0 && (v === ',' || v === ';')) break;
        }
        p++;
      }
      if (p === s) continue;
      var hs = isP(toks[i - 1], ')') && match[i - 1] >= 0 ? match[i - 1] : Math.max(i - 1, 0);
      var b = { nodeType: 'block', id: M.blocks.length, kind: 'lambda', open: s, close: p - 1, line: 0, endLine: 0, parent: null,
        children: [], header: { start: hs, end: i + 1 }, cond: null, loop: false, dead: false, statements: [],
        typeRef: null, methodRef: null, elseOf: null, braceless: true, exprBlock: true, exprBody: true, iterates: false,
        caseCond: null, depth: 0, ownerStmt: null, argOf: null, argIndex: -1, parenOpen: -1, parenClose: -1, unclosed: false };
      M.blocks.push(b);
      var st = { nodeType: 'statement', id: M.statements.length, kind: null, start: s, end: p, line: toks[s].line, block: b,
        headerOf: null, childBlocks: [], caseCond: null, dead: false, enumConstants: false, lambdaBody: true };
      M.statements.push(st); b.statements.push(st);
    }
  }

  // Parent/child links by range nesting, token → innermost block and statement maps.
  function paint(M, S) {
    var toks = S.toks, n = S.n, blocks = M.blocks;
    var tokBlock = new Int32Array(n + 1), tokStmt = new Int32Array(n + 1).fill(-1);
    S.tokBlock = tokBlock; S.tokStmt = tokStmt;
    var order = blocks.slice(1).sort(function (a, b) { return a.open - b.open || b.close - a.close || a.id - b.id; });
    S.blockOrder = order;
    var root = blocks[0];
    root.children = []; root.line = 1; root.endLine = n ? toks[n - 1].line : 1;
    for (var k = 0; k < order.length; k++) {
      var b = order[k];
      if (b.close < b.open) b.close = b.open;
      var s = Math.max(0, b.open), e = Math.min(n, b.close);
      var p = blocks[tokBlock[s]] || root;
      b.parent = p; p.children.push(b); b.depth = p.depth + 1;
      b.line = toks[s].line;
      var et = toks[e].type === 'eof' && e > 0 ? toks[e - 1] : toks[e];
      b.endLine = et ? et.line : b.line;
      b.headerLine = toks[Math.max(0, b.header.start)] ? toks[Math.max(0, b.header.start)].line : b.line;
      for (var j = s; j <= e; j++) tokBlock[j] = b.id;
    }
    M.statements.sort(function (a, b) { return a.start - b.start || b.end - a.end || a.id - b.id; });   // source order
    M.statements.forEach(function (st, k) { st.id = k; });
    var sts = M.statements;
    for (var q = 0; q < sts.length; q++) {
      var st = sts[q];
      for (var r = st.start; r < st.end && r <= n; r++) tokStmt[r] = st.id;
      var lastTok = toks[Math.min(st.end - 1, n)];
      st.endLine = lastTok ? lastTok.line : st.line;
    }
    for (var bi = 1; bi < blocks.length; bi++) {
      var bb = blocks[bi];
      var at = bb.braceless ? bb.header.start : bb.open;
      var sid = at >= 0 ? tokStmt[at] : -1;
      bb.ownerStmt = sid >= 0 ? M.statements[sid] : null;
      bb.statements.sort(function (a, b) { return a.start - b.start; });
      bb.iterates = bb.kind === 'while' || bb.kind === 'do' || bb.kind === 'for' || bb.kind === 'foreach';
    }
  }

  // ── Declarations: types, methods, parameters, fields, locals ───────────────
  function skipGeneric(S, p, lim) {
    var toks = S.toks, gen = S.flags.gen, depth = 0;
    for (var k = p; k < lim; k++) {
      var t = toks[k];
      if (!gen[k]) { if (k === p) return -1; continue; }
      if (t.value === '<') depth++;
      else depth -= t.value.length;
      if (depth <= 0) return k + 1;
    }
    return -1;
  }

  function parseType(S, p, lim) {
    var toks = S.toks, s = p, t = toks[p];
    while (t && t.type === 'annotation' && p < lim) {
      p++;
      if (isP(toks[p], '(') && S.match[p] > p) p = S.match[p] + 1;
      t = toks[p];
    }
    if (!t || p >= lim) return null;
    var base;
    if (t.type === 'keyword' && (PRIMITIVES[t.value] || t.value === 'var')) { base = t.value; p++; }
    else if (t.type === 'ident') {
      base = t.value; p++;
      for (;;) {
        if (p < lim && S.flags.gen[p] && toks[p].value === '<') { var g = skipGeneric(S, p, lim); if (g < 0) return null; p = g; }
        if (p + 1 < lim && isP(toks[p], '.') && toks[p + 1].type === 'ident') { base = toks[p + 1].value; p += 2; continue; }
        break;
      }
    } else return null;
    var isArray = false, varargs = false;
    while (p + 1 < lim && isP(toks[p], '[') && isP(toks[p + 1], ']')) { isArray = true; p += 2; }
    if (p < lim && isOp(toks[p], '...')) { isArray = true; varargs = true; p++; }
    return { start: s, end: p, base: base, text: S.TX.compact(s, p), isArray: isArray, varargs: varargs };
  }

  function skipModifiers(S, p, lim, mods, anns) {
    var toks = S.toks;
    while (p < lim) {
      var t = toks[p];
      if (t.type === 'annotation' && t.value !== '@interface') {
        if (anns) anns.push({ name: t.name, text: t.value, line: t.line, args: null });
        p++;
        if (isP(toks[p], '(') && S.match[p] > p && S.match[p] < lim) {
          if (anns) anns[anns.length - 1].args = { start: p + 1, end: S.match[p], text: S.TX.compact(p + 1, S.match[p]) };
          p = S.match[p] + 1;
        }
        continue;
      }
      if ((t.type === 'keyword' && MODIFIERS[t.value]) || (t.type === 'ident' && t.value === 'non')) { if (mods) mods.push(t.value); p++; continue; }
      break;
    }
    return p;
  }

  // Top-level split of [s, e) at a separator (',' or ';'), respecting (), [], {} and generics.
  function splitTop(S, s, e, sep) {
    var toks = S.toks, gen = S.flags.gen, parts = [], depth = 0, gdepth = 0, ps = s;
    for (var k = s; k < e; k++) {
      var t = toks[k], v = t.value;
      if (t.type === 'punct') {
        if (v === '(' || v === '[' || v === '{') depth++;
        else if (v === ')' || v === ']' || v === '}') depth--;
        else if (v === sep && depth === 0 && gdepth === 0) { parts.push({ start: ps, end: k }); ps = k + 1; }
      } else if (gen[k]) {
        if (v === '<') gdepth++; else gdepth = Math.max(0, gdepth - v.length);
      }
    }
    parts.push({ start: ps, end: e });
    return parts.filter(function (x) { return x.end > x.start; });
  }

  function exprEnd(S, s, e) {                     // end of an initializer: depth-0 ',' or e
    var toks = S.toks, gen = S.flags.gen, depth = 0, gdepth = 0;
    for (var k = s; k < e; k++) {
      var t = toks[k], v = t.value;
      if (t.type === 'punct') {
        if (v === '(' || v === '[' || v === '{') depth++;
        else if (v === ')' || v === ']' || v === '}') { if (depth === 0) return k; depth--; }
        else if ((v === ',' || v === ';') && depth === 0 && gdepth === 0) return k;
      } else if (gen[k]) {
        if (v === '<') gdepth++; else gdepth = Math.max(0, gdepth - v.length);
      }
    }
    return e;
  }

  // `[mods] Type name [= init] [, name2 [= init]]` over [s, e)
  function parseDeclRange(S, s, e) {
    var toks = S.toks, mods = [], anns = [];
    var p = skipModifiers(S, s, e, mods, anns);
    var ty = parseType(S, p, e);
    if (!ty) return null;
    p = ty.end;
    if (p >= e || !(toks[p].type === 'ident' || (isIdentLike(toks[p]) && toks[p].value !== 'var' && toks[p].value !== 'yield'))) return null;
    var out = [];
    while (p < e && isIdentLike(toks[p])) {
      var nameIdx = p, dims = false;
      p++;
      while (p + 1 < e && isP(toks[p], '[') && isP(toks[p + 1], ']')) { dims = true; p += 2; }
      var init = null;
      if (p < e && isOp(toks[p], '=')) {
        var ie = exprEnd(S, p + 1, e);
        init = { start: p + 1, end: ie, eq: p };
        p = ie;
      } else if (p < e && !isP(toks[p], ',') && !isOp(toks[p], ':')) {
        if (!out.length) return null;
        break;
      }
      out.push({ nameIdx: nameIdx, name: toks[nameIdx].value, dims: dims, init: init });
      if (p < e && isP(toks[p], ',')) { p++; continue; }
      break;
    }
    if (!out.length) return null;
    return { mods: mods, anns: anns, type: ty, decls: out, end: p };
  }

  function typesAndMethods(M, S) {
    var toks = S.toks, match = S.match;
    S.typeByName = Object.create(null);
    S.rootCtx = { nodeType: 'ctx', kind: 'root', reachable: false };
    var order = S.blockOrder;
    for (var k = 0; k < order.length; k++) {
      var b = order[k], p = b.parent;
      b.typeRef = p.typeRef; b.methodRef = p.methodRef;
      if (b.kind === 'type') {
        var T = makeType(M, S, b, p);
        b.typeRef = T;
      } else if (b.kind === 'method') {
        var m = makeMethod(M, S, b, p);
        b.methodRef = m;
        if (m.isCtor) b.kind = 'ctor';
      }
    }
    M.types.forEach(function (T) { if (!S.typeByName[T.name]) S.typeByName[T.name] = T; });
    S.blocks0 = M.blocks[0];

    function makeType(M, S, b, p) {
      var s = b.header.start, e = b.header.end, mods = [], anns = [];
      var q = skipModifiers(S, s, e, mods, anns);
      while (q < e && !(isKw(toks[q], 'class') || isKw(toks[q], 'interface') || isKw(toks[q], 'enum') || isKw(toks[q], 'record') ||
        (toks[q].type === 'annotation' && toks[q].value === '@interface'))) q++;
      var kw = toks[q], kind = !kw || q >= e ? 'class' : kw.type === 'annotation' ? 'interface' : kw.value;
      var nameTok = isIdentLike(toks[q + 1]) && q + 1 < e ? toks[q + 1] : null;
      var T = { nodeType: 'type', id: M.types.length, name: nameTok ? nameTok.value : '', kind: kind, extends: null, extendsName: null,
        extendsList: [], implements: [], annotations: anns.map(function (a) { return a.name; }), annotationDetails: anns, modifiers: mods,
        block: b, outer: p.typeRef || null, line: nameTok ? nameTok.line : toks[Math.max(0, s)].line, endLine: b.endLine,
        fields: [], methods: [], enumConstants: [], nameIndex: nameTok ? q + 1 : -1, recordComponents: [] };
      T.initCtx = { nodeType: 'ctx', kind: 'typeinit', type: T, reachable: false };
      b.typeKind = kind;
      var r = nameTok ? q + 2 : q + 1;
      if (r < e && S.flags.gen[r] && toks[r].value === '<') { var g = skipGeneric(S, r, e); if (g > 0) r = g; }
      if (kind === 'record' && isP(toks[r], '(') && match[r] > r) {
        T.recordComponents = parseParams(S, r + 1, match[r]);
        S.flags.notCall[q + 1] = 1;
        r = match[r] + 1;
      }
      var mode = null;
      while (r < e) {
        var t = toks[r];
        if (isKw(t, 'extends')) { mode = 'extends'; r++; continue; }
        if (isKw(t, 'implements')) { mode = 'implements'; r++; continue; }
        if (isKw(t, 'permits')) { mode = 'permits'; r++; continue; }
        if (isP(t, ',')) { r++; continue; }
        var ty = parseType(S, r, e);
        if (!ty) { r++; continue; }
        if (mode === 'extends') { T.extendsList.push(ty.text); if (!T.extends) { T.extends = ty.text; T.extendsName = ty.base; } }
        else if (mode === 'implements') T.implements.push(ty.text);
        r = Math.max(ty.end, r + 1);
      }
      if (kind === 'interface' && T.extendsList.length > 1) T.implements = T.implements.concat(T.extendsList.slice(1));
      M.types.push(T);
      if (T.outer) T.outer.nested = (T.outer.nested || []).concat([T]);
      T.recordComponents.forEach(function (rc) {
        var d = addDecl(M, S, { name: rc.name, typeInfo: rc.typeInfo, nameIdx: rc.nameIdx, init: null, block: b, method: null, scope: 'field',
          scopeStart: b.open, scopeEnd: b.close, modifiers: ['private', 'final'] });
        addField(M, T, d);
      });
      return T;
    }

    function makeMethod(M, S, b, p) {
      var owner = p.kind === 'type' ? p.typeRef : null;
      var nameIdx = b.nameIdx, mods = [], anns = [];
      var q = skipModifiers(S, b.header.start, nameIdx, mods, anns);
      if (q < nameIdx && S.flags.gen[q] && toks[q].value === '<') { var g = skipGeneric(S, q, nameIdx); if (g > 0) q = g; }
      var returnType = q < nameIdx ? S.TX.compact(q, nameIdx) : null;
      var name = toks[nameIdx] ? toks[nameIdx].value : '';
      var isCtor = returnType === null && !!owner && name === owner.name;
      if (returnType === null && !isCtor && p.kind === 'anon') isCtor = false;
      var m = { nodeType: 'method', id: M.methods.length, name: name, returnType: returnType, params: [], modifiers: mods,
        annotations: anns.map(function (a) { return a.name; }), owner: owner, isCtor: isCtor, block: b,
        line: toks[nameIdx] ? toks[nameIdx].line : b.line, endLine: b.endLine, reachable: false, anonymous: p.kind === 'anon',
        nameIndex: nameIdx, enclosingCtx: null, abstract: false };
      S.flags.notCall[nameIdx] = 1;
      if (b.parenOpen >= 0) {
        parseParams(S, b.parenOpen + 1, b.parenClose).forEach(function (pp) {
          m.params.push({ type: pp.typeInfo ? pp.typeInfo.text : null, typeText: pp.typeInfo ? pp.typeInfo.text : null,
            baseType: pp.typeInfo ? pp.typeInfo.base : null, name: pp.name, line: toks[pp.nameIdx].line });
          addDecl(M, S, { name: pp.name, typeInfo: pp.typeInfo, nameIdx: pp.nameIdx, init: null, block: b, method: m, scope: 'param',
            scopeStart: b.header.start, scopeEnd: b.close, modifiers: pp.mods });
        });
      }
      M.methods.push(m);
      if (owner) owner.methods.push(m);
      return m;
    }
  }

  function parseParams(S, s, e) {
    var toks = S.toks, out = [];
    splitTop(S, s, e, ',').forEach(function (part) {
      var mods = [];
      var p = skipModifiers(S, part.start, part.end, mods, null);
      if (part.end - p === 1 && isIdentLike(toks[p])) { out.push({ name: toks[p].value, nameIdx: p, typeInfo: null, mods: mods }); return; }
      var ty = parseType(S, p, part.end);
      if (!ty) return;
      var ni = ty.end;
      if (ni < part.end && isIdentLike(toks[ni])) out.push({ name: toks[ni].value, nameIdx: ni, typeInfo: ty, mods: mods });
    });
    return out;
  }

  function addDecl(M, S, o) {
    var toks = S.toks, ti = o.typeInfo;
    var d = { nodeType: 'decl', id: M.decls.length, name: o.name, type: ti ? ti.base : null, typeText: ti ? ti.text : (o.typeText || null),
      isArray: !!(ti && ti.isArray) || !!o.dims, init: o.init ? { start: o.init.start, end: o.init.end } : null,
      line: toks[o.nameIdx].line, block: o.block, method: o.method || null, scope: o.scope, index: o.nameIdx,
      scopeStart: o.scopeStart, scopeEnd: o.scopeEnd, modifiers: o.modifiers || [], inferredType: null };
    if (o.dims && d.typeText) d.typeText += '[]';
    if (d.init && d.type === 'var' && isKw(toks[d.init.start], 'new') && isIdentLike(toks[d.init.start + 1])) {
      var ty = parseType(S, d.init.start + 1, d.init.end);
      if (ty) d.inferredType = ty.base;
    }
    if (o.init && o.init.eq != null) S.flags.declEq[o.init.eq] = 1;
    M.decls.push(d);
    var map = S.declsByName || (S.declsByName = Object.create(null));
    (map[d.name] || (map[d.name] = [])).push(d);
    return d;
  }

  function addField(M, T, d) {
    var f = { nodeType: 'field', name: d.name, type: d.type, typeText: d.typeText, isArray: d.isArray, modifiers: d.modifiers,
      init: d.init, owner: T, line: d.line, decl: d, index: d.index, block: d.block };
    M.fields.push(f);
    if (T) T.fields.push(f);
    d.field = f;
    return f;
  }

  function importsPass(M, S) {
    var toks = S.toks;
    S.blocks0.statements.forEach(function (st) {
      var t = toks[st.start];
      if (!isKw(t, 'import') && !isKw(t, 'package')) return;
      st.isImport = true;
      if (isKw(t, 'package')) return;
      var p = st.start + 1, isStatic = false;
      if (isKw(toks[p], 'static')) { isStatic = true; p++; }
      var parts = [], wildcard = false;
      for (; p < st.end; p++) {
        var u = toks[p];
        if (isIdentLike(u) || u.type === 'keyword') parts.push(u.value);
        else if (isOp(u, '*')) { wildcard = true; parts.push('*'); }
      }
      if (!parts.length) return;
      if (isStatic) {
        var name = parts[parts.length - 1], cls = wildcard ? parts[parts.length - 2] : parts[parts.length - 2];
        var qual = parts.slice(0, parts.length - 1).join('.');
        M.staticImports.push({ className: cls || '', qualified: qual, name: wildcard ? '*' : name, wildcard: wildcard, line: t.line });
      } else {
        M.imports.push({ path: parts.join('.'), name: parts[parts.length - 1], wildcard: wildcard, line: t.line });
      }
    });
  }

  function declsPass(M, S) {
    var toks = S.toks, match = S.match, blocks = M.blocks;
    // Headers of control blocks and lambdas
    for (var bi = 1; bi < blocks.length; bi++) {
      var b = blocks[bi], o = b.parenOpen, c = b.parenClose;
      var method = b.methodRef;
      if (b.kind === 'for' && o >= 0) {
        var semis = splitTop(S, o + 1, c, ';');
        var firstSemi = -1, depth = 0;
        for (var k = o + 1; k < c; k++) {
          var t = toks[k];
          if (isP(t, '(') || isP(t, '[') || isP(t, '{')) depth++;
          else if (isP(t, ')') || isP(t, ']') || isP(t, '}')) depth--;
          else if (depth === 0 && isP(t, ';')) { firstSemi = k; break; }
        }
        if (firstSemi > o + 1) {
          var dr = parseDeclRange(S, o + 1, firstSemi);
          if (dr) dr.decls.forEach(function (x) {
            addDecl(M, S, { name: x.name, typeInfo: dr.type, dims: x.dims, nameIdx: x.nameIdx, init: x.init, block: b, method: method,
              scope: 'local', scopeStart: b.header.start, scopeEnd: b.close, modifiers: dr.mods });
          });
        }
        b.forSemis = semis;
      } else if (b.kind === 'foreach' && o >= 0) {
        var colon = -1, d2 = 0;
        for (var k2 = o + 1; k2 < c; k2++) {
          var t2 = toks[k2];
          if (isP(t2, '(') || isP(t2, '[')) d2++;
          else if (isP(t2, ')') || isP(t2, ']')) d2--;
          else if (d2 === 0 && isOp(t2, ':')) { colon = k2; break; }
        }
        if (colon > 0) {
          b.iterRange = { start: colon + 1, end: c };
          var fr = parseDeclRange(S, o + 1, colon);
          if (fr && fr.decls.length) {
            var fx = fr.decls[0];
            addDecl(M, S, { name: fx.name, typeInfo: fr.type, nameIdx: fx.nameIdx, init: { start: colon + 1, end: c }, block: b, method: method,
              scope: 'foreach', scopeStart: b.header.start, scopeEnd: b.close, modifiers: fr.mods });
          }
        }
      } else if (b.kind === 'catch' && o >= 0) {
        var mods = [], p = skipModifiers(S, o + 1, c, mods, null), texts = [], base = null, nameIdx = -1;
        while (p < c) {
          var ty = parseType(S, p, c);
          if (!ty) break;
          texts.push(ty.text); if (!base) base = ty.base;
          p = ty.end;
          if (isOp(toks[p], '|')) { p++; continue; }
          if (isIdentLike(toks[p])) nameIdx = p;
          break;
        }
        if (nameIdx >= 0) addDecl(M, S, { name: toks[nameIdx].value, typeInfo: { base: base, text: texts.join(' | '), isArray: false }, nameIdx: nameIdx,
          init: null, block: b, method: method, scope: 'catch', scopeStart: b.header.start, scopeEnd: b.close, modifiers: mods });
      } else if (b.kind === 'try' && o >= 0) {
        splitTop(S, o + 1, c, ';').forEach(function (part) {
          var tr = parseDeclRange(S, part.start, part.end);
          if (tr) tr.decls.forEach(function (x) {
            addDecl(M, S, { name: x.name, typeInfo: tr.type, nameIdx: x.nameIdx, init: x.init, block: b, method: method, scope: 'local',
              scopeStart: b.header.start, scopeEnd: b.close, modifiers: tr.mods });
          });
        });
      } else if (b.kind === 'lambda') {
        var arrow = b.header.end - 1, hs = b.header.start;
        if (!isOp(toks[arrow], '->')) { arrow = b.header.end - 2; }
        var params = [];
        if (isP(toks[hs], '(') && match[hs] > hs) params = parseParams(S, hs + 1, match[hs]);
        else if (isIdentLike(toks[hs])) params = [{ name: toks[hs].value, nameIdx: hs, typeInfo: null, mods: [] }];
        params.forEach(function (pp) {
          addDecl(M, S, { name: pp.name, typeInfo: pp.typeInfo, nameIdx: pp.nameIdx, init: null, block: b, method: method, scope: 'lambda',
            scopeStart: hs, scopeEnd: b.close, modifiers: pp.mods });
        });
      }
    }
    // Statements: fields, locals, enum constants, abstract methods
    M.statements.forEach(function (st) {
      if (st.kind === 'label' || st.headerOf || st.isImport) return;
      var b = st.block, e = st.end;
      if (isP(toks[e - 1], ';')) e--;
      if (e <= st.start) return;
      var typeBody = b.kind === 'type' || b.kind === 'anon';
      if (st.enumConstants && b.kind === 'type' && b.typeKind === 'enum') {
        var T = b.typeRef;
        splitTop(S, st.start, e, ',').forEach(function (part) {
          var p = skipModifiers(S, part.start, part.end, null, null);
          if (!isIdentLike(toks[p])) return;
          S.flags.notCall[p] = 1;
          var init = isP(toks[p + 1], '(') && match[p + 1] > p ? { start: p + 2, end: match[p + 1] } : null;
          addDecl(M, S, { name: toks[p].value, typeInfo: { base: T ? T.name : null, text: T ? T.name : null, isArray: false }, nameIdx: p,
            init: init, block: b, method: null, scope: 'enum', scopeStart: b.open, scopeEnd: b.close, modifiers: ['public', 'static', 'final'] });
          if (T) T.enumConstants.push(toks[p].value);
        });
        st.isDecl = true;
        return;
      }
      var dr = parseDeclRange(S, st.start, e);
      if (dr && dr.end >= e - 0) {
        st.isDecl = true;
        dr.decls.forEach(function (x) {
          var d = addDecl(M, S, { name: x.name, typeInfo: dr.type, dims: x.dims, nameIdx: x.nameIdx, init: x.init, block: b,
            method: typeBody ? null : b.methodRef, scope: typeBody ? 'field' : 'local',
            scopeStart: typeBody ? b.open : x.nameIdx, scopeEnd: b.close, modifiers: dr.mods });
          if (typeBody) addField(M, b.kind === 'type' ? b.typeRef : null, d);
        });
        return;
      }
      if (typeBody || b.kind === 'root') {                        // abstract / interface method signature
        var mods = [], anns = [];
        var q = skipModifiers(S, st.start, e, mods, anns);
        if (q < e && S.flags.gen[q] && toks[q].value === '<') { var g = skipGeneric(S, q, e); if (g > 0) q = g; }
        var rt = parseType(S, q, e);
        if (rt && isIdentLike(toks[rt.end]) && isP(toks[rt.end + 1], '(') && match[rt.end + 1] > 0 && match[rt.end + 1] < e + 1) {
          var ni = rt.end, owner = b.kind === 'type' ? b.typeRef : null;
          var m = { nodeType: 'method', id: M.methods.length, name: toks[ni].value, returnType: rt.text, params: [], modifiers: mods,
            annotations: anns.map(function (a) { return a.name; }), owner: owner, isCtor: false, block: null, line: toks[ni].line,
            endLine: toks[e - 1].line, reachable: false, anonymous: b.kind === 'anon', nameIndex: ni, enclosingCtx: null, abstract: true };
          parseParams(S, ni + 2, match[ni + 1]).forEach(function (pp) {
            m.params.push({ type: pp.typeInfo ? pp.typeInfo.text : null, typeText: pp.typeInfo ? pp.typeInfo.text : null,
              baseType: pp.typeInfo ? pp.typeInfo.base : null, name: pp.name, line: toks[pp.nameIdx].line });
          });
          S.flags.notCall[ni] = 1;
          M.methods.push(m);
          if (owner) owner.methods.push(m);
          st.isSignature = true;
        }
      }
    });
  }

  // ── Calls, `new`, method references ────────────────────────────────────────
  function callsPass(M, S) {
    var toks = S.toks, n = S.n, match = S.match, flags = S.flags, TX = S.TX;
    var callAt = S.callAt = Object.create(null);
    var callEndAt = S.callEndAt = Object.create(null);
    S.callsByName = Object.create(null);

    function splitArgs(openIdx) {
      var close = match[openIdx];
      if (close < 0) return { args: [], end: openIdx + 1 };
      var parts = splitTop(S, openIdx + 1, close, ',');
      return {
        args: parts.map(function (p) { return { start: p.start, end: p.end, text: TX.spaced(p.start, p.end) }; }),
        end: close + 1
      };
    }
    function blockAt(i) { return M.blocks[S.tokBlock[i]] || M.blocks[0]; }

    for (var i = 0; i < n; i++) {
      var t = toks[i];
      if (flags.anno[i]) continue;
      if (isKw(t, 'new')) { parseNew(i); continue; }
      if (isOp(t, '::')) {
        var rn = toks[i + 1];
        if (rn && (isIdentLike(rn) || isKw(rn, 'new'))) {
          var rs = i - 1;
          while (rs - 2 >= 0 && isP(toks[rs - 1], '.') && (isIdentLike(toks[rs - 2]) || isKw(toks[rs - 2], 'this'))) rs -= 2;
          M.methodRefs.push({ nodeType: 'methodRef', name: rn.value, receiverText: TX.compact(rs, i), start: rs, end: i + 2, index: i + 1,
            line: rn.line, block: blockAt(i) });
        }
        continue;
      }
      var isThisSuper = isKw(t, 'this') || isKw(t, 'super');
      if (!(isIdentLike(t) || isThisSuper)) continue;
      if (!isP(toks[i + 1], '(') || flags.notCall[i]) continue;
      if (isThisSuper && isP(toks[i - 1], '.')) continue;
      var q = i;
      while (q - 2 >= 0 && isP(toks[q - 1], '.') && isIdentLike(toks[q - 2])) q -= 2;
      if (isKw(toks[q - 1], 'new')) continue;
      makeCall(i, isThisSuper);
    }

    function makeCall(i, ctorCall) {
      var parts = [], k = i - 1, indexed = false, complex = false, recvStart = i, isNew = false;
      while (k >= 0 && isP(toks[k], '.')) {
        var e = k - 1;
        if (e < 0) break;
        while (e >= 0 && isP(toks[e], ']') && match[e] >= 0) { indexed = true; e = match[e] - 1; }
        var te = toks[e];
        if (!te || e < 0) { complex = true; break; }
        if (isP(te, ')') && match[e] >= 0) {
          var o = match[e], nm = toks[o - 1];
          if (nm && (isIdentLike(nm) || isKw(nm, 'this') || isKw(nm, 'super')) && o - 1 >= 0) {
            parts.unshift({ call: true, name: nm.value, idx: o - 1 });
            recvStart = o - 1; k = o - 2; continue;
          }
          complex = true; recvStart = o; break;
        }
        if (isIdentLike(te) || isKw(te, 'this') || isKw(te, 'super') || te.type === 'ident') {
          parts.unshift({ call: false, name: te.value, idx: e });
          recvStart = e; k = e - 1; continue;
        }
        complex = true; recvStart = k; break;
      }
      if (parts.length && parts[0].call) {                          // new Foo().bar()
        var q = parts[0].idx;
        while (q - 2 >= 0 && isP(toks[q - 1], '.') && isIdentLike(toks[q - 2])) q -= 2;
        if (isKw(toks[q - 1], 'new')) { isNew = true; parts[0].call = false; parts[0].isNew = true; recvStart = q - 1; }
      }
      var hasCall = parts.some(function (p) { return p.call; });
      var names = parts.map(function (p) { return p.name; });
      if (names[0] === 'this') { names = names.slice(1); parts = parts.slice(1); }
      var receiverChain = !hasCall && !complex && !isNew ? names.slice() : [];
      var receiverText = recvStart < i ? TX.compact(recvStart, i - 1) : '';
      var chainRoot = null;
      if (complex) chainRoot = null;
      else if (isNew) chainRoot = 'new ' + names[0];
      else if (hasCall) {
        var dotted = [];
        for (var pi = 0; pi < parts.length; pi++) { dotted.push(parts[pi].name); if (parts[pi].call) break; }
        chainRoot = dotted.join('.');
      } else chainRoot = receiverChain.length ? receiverChain[0] : toks[i].value;
      var a = splitArgs(i + 1);
      var c = { nodeType: 'call', id: M.calls.length, name: toks[i].value, receiverChain: receiverChain, receiverText: receiverText,
        chainRoot: chainRoot, rootIdent: names.length ? names[0] : toks[i].value, receiverIsCall: hasCall, receiverIsNew: isNew,
        receiverIndexed: indexed, receiverCall: null, chainStart: complex ? i : recvStart, args: a.args, start: i, end: a.end,
        line: toks[i].line, col: toks[i].col, block: blockAt(i), method: null, type: null, statement: null, inLoop: false, loopDepth: 0,
        condChain: [], dead: false, reachable: false, live: false, isStatementHead: false, ctorCall: !!ctorCall,
        receiverCallIndex: parts.length && parts[parts.length - 1].call ? parts[parts.length - 1].idx : -1 };
      if (receiverText === 'this') c.receiverText = 'this';
      M.calls.push(c);
      callAt[i] = c;
      (S.callsByName[c.name] || (S.callsByName[c.name] = [])).push(c);
      if (!callEndAt[c.end]) callEndAt[c.end] = c;
    }

    function parseNew(i) {
      var p = skipModifiers(S, i + 1, n, null, null);
      var ty = parseType(S, p, n);
      var tn = toks[p];
      if (!ty && !(tn && tn.type === 'keyword' && PRIMITIVES[tn.value])) return;
      var typeName = ty ? ty.base : tn.value, typeText = ty ? ty.text : tn.value, q = ty ? ty.end : p + 1;
      if (ty && ty.isArray) q = ty.start + (ty.end - ty.start);
      var nw = { nodeType: 'new', id: M.news.length, typeName: typeName, typeText: typeText, args: [], line: toks[i].line, block: blockAt(i),
        method: null, type: null, start: i, end: q, index: i, isArray: false, anonBlock: null, dead: false, reachable: false, live: false };
      if (isP(toks[q], '(')) {
        var a = splitArgs(q);
        nw.args = a.args; nw.end = a.end;
        if (isP(toks[a.end], '{')) {
          for (var bi = 1; bi < M.blocks.length; bi++) if (M.blocks[bi].open === a.end) { nw.anonBlock = M.blocks[bi]; break; }
        }
      } else if (isP(toks[q], '[') || (ty && ty.isArray)) {
        nw.isArray = true;
        var r = q;
        while (isP(toks[r], '[') && match[r] > r) r = match[r] + 1;
        if (isP(toks[r], '{') && match[r] > r) r = match[r] + 1;
        nw.end = r;
      }
      M.news.push(nw);
    }

    // Link each chained call to the call it is invoked on.
    M.calls.forEach(function (c) { if (c.receiverCallIndex >= 0) c.receiverCall = callAt[c.receiverCallIndex] || null; });
  }

  // ── Statement kinds ────────────────────────────────────────────────────────
  function statementKinds(M, S) {
    var toks = S.toks;
    M.statements.forEach(function (st) {
      if (st.kind === 'label') return;
      if (st.headerOf) { st.kind = 'block'; return; }
      var e = st.end;
      if (isP(toks[e - 1], ';')) e--;
      var f = toks[st.start];
      if (f.type === 'keyword' && JUMP_KW[f.value]) { st.kind = f.value; return; }
      if (st.isImport) { st.kind = 'other'; return; }
      if (st.isDecl) { st.kind = 'decl'; return; }
      if (hasTopAssign(st.start, e)) { st.kind = 'assign'; return; }
      var c = S.callEndAt[e];
      if (c && (c.chainStart === st.start || (c.receiverIsNew && c.chainStart === st.start))) { st.kind = 'call'; c.isStatementHead = true; return; }
      if (e > st.start) {
        var junk = true;
        for (var k = st.start; k < e; k++) {
          var t = toks[k];
          if (!(t.type === 'ident' || t.type === 'number' || t.type === 'string' || t.type === 'char' || isP(t, '.'))) { junk = false; break; }
        }
        if (junk) { st.kind = 'junk'; return; }
      }
      st.kind = 'other';
    });
    function hasTopAssign(s, e) {
      var depth = 0;
      for (var k = s; k < e; k++) {
        var t = toks[k];
        if (t.type === 'punct') {
          if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
          else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
        } else if (depth === 0 && t.type === 'op' && (ASSIGN_OPS[t.value] || t.value === '++' || t.value === '--') && !S.flags.declEq[k]) return true;
      }
      return false;
    }
  }

  // ── Assignments ────────────────────────────────────────────────────────────
  function assignsPass(M, S) {
    var toks = S.toks, n = S.n, match = S.match, flags = S.flags;
    S.assignsByBase = Object.create(null);
    function lvalueBack(k) {
      var end = k + 1, p = k, parts = [], indexed = false;
      for (var guard = 0; p >= 0 && guard < 200; guard++) {
        var t = toks[p];
        if (isP(t, ']') && match[p] >= 0) { indexed = true; p = match[p] - 1; continue; }
        if (isIdentLike(t) || isKw(t, 'this') || isKw(t, 'super')) {
          parts.unshift(t.value);
          if (isP(toks[p - 1], '.') && p - 2 >= 0 && (isIdentLike(toks[p - 2]) || isKw(toks[p - 2], 'this') || isP(toks[p - 2], ']'))) { p -= 2; continue; }
          break;
        }
        return null;
      }
      if (!parts.length) return null;
      return { start: p, end: end, parts: parts, indexed: indexed };
    }
    function lvalueFwd(k) {
      var p = k, parts = [], indexed = false;
      for (var guard = 0; p < n && guard < 200; guard++) {
        var t = toks[p];
        if (!(isIdentLike(t) || isKw(t, 'this'))) break;
        parts.push(t.value); p++;
        while (isP(toks[p], '[') && match[p] > p) { indexed = true; p = match[p] + 1; }
        if (isP(toks[p], '.') && (isIdentLike(toks[p + 1]) || isKw(toks[p + 1], 'this'))) { p++; continue; }
        break;
      }
      if (!parts.length) return null;
      return { start: k, end: p, parts: parts, indexed: indexed };
    }
    function rhsEnd(s) {
      var depth = 0;
      for (var k = s; k < n; k++) {
        var t = toks[k];
        if (t.type === 'punct') {
          var v = t.value;
          if (v === '(' || v === '[' || v === '{') depth++;
          else if (v === ')' || v === ']' || v === '}') { if (depth === 0) return k; depth--; }
          else if (depth === 0 && (v === ';' || v === ',')) return k;
        }
      }
      return n;
    }
    for (var i = 0; i < n; i++) {
      var t = toks[i];
      if (t.type !== 'op' || flags.anno[i] || flags.declEq[i]) continue;
      var op = t.value, lv = null, rhs = null;
      if (ASSIGN_OPS[op]) {
        lv = lvalueBack(i - 1);
        if (!lv) continue;
        rhs = { start: i + 1, end: rhsEnd(i + 1) };
      } else if (op === '++' || op === '--') {
        var pv = toks[i - 1];
        if (pv && (isIdentLike(pv) || isP(pv, ']'))) lv = lvalueBack(i - 1);
        else lv = lvalueFwd(i + 1);
        if (!lv) continue;
        rhs = { start: lv.start, end: lv.end };
      } else continue;
      var parts = lv.parts[0] === 'this' ? lv.parts.slice(1) : lv.parts;
      if (!parts.length) continue;
      var tStart = lv.parts[0] === 'this' ? lv.start + 2 : lv.start;
      var target = S.TX.compact(tStart, lv.end).replace(/\s+/g, '');
      var blk = M.blocks[S.tokBlock[i]] || M.blocks[0];
      var a = { nodeType: 'assign', id: M.assigns.length, target: target, targetRoot: parts[0], targetBase: parts.join('.'), op: op,
        rhs: rhs, line: t.line, block: blk, method: null, type: null, index: i, start: Math.min(lv.start, i), end: Math.max(rhs.end, i + 1),
        indexed: lv.indexed, statement: null, dead: false, reachable: false, live: false };
      M.assigns.push(a);
      (S.assignsByBase[a.targetBase] || (S.assignsByBase[a.targetBase] = [])).push(a);
    }
  }

  // ── Conditions ─────────────────────────────────────────────────────────────
  function numLit(S, s, e) {
    var toks = S.toks, neg = false;
    if (e - s === 2 && isOp(toks[s], '-')) { neg = true; s++; }
    if (e - s !== 1 || toks[s].type !== 'number') return null;
    var raw = toks[s].value.replace(/_/g, '').replace(/[lLfFdD]$/, '');
    var v = /^0[xX]/.test(raw) ? parseInt(raw.slice(2), 16) : /^0[bB]/.test(raw) ? parseInt(raw.slice(2), 2) : parseFloat(raw);
    if (isNaN(v)) return null;
    return neg ? -v : v;
  }

  function constValue(S, s, e, depthGuard) {
    var toks = S.toks, match = S.match;
    if ((depthGuard || 0) > 60 || e <= s) return null;
    while (isP(toks[s], '(') && match[s] === e - 1 && e - s > 1) { s++; e--; }
    var ors = splitOps(S, s, e, '||');
    if (ors.length > 1) {
      var allF = true;
      for (var i = 0; i < ors.length; i++) {
        var v = constValue(S, ors[i].start, ors[i].end, (depthGuard || 0) + 1);
        if (v === true) return true;
        if (v !== false) allF = false;
      }
      return allF ? false : null;
    }
    var ands = splitOps(S, s, e, '&&');
    if (ands.length > 1) {
      var allT = true;
      for (var j = 0; j < ands.length; j++) {
        var w = constValue(S, ands[j].start, ands[j].end, (depthGuard || 0) + 1);
        if (w === false) return false;
        if (w !== true) allT = false;
      }
      return allT ? true : null;
    }
    if (e - s === 1) { if (isKw(toks[s], 'true')) return true; if (isKw(toks[s], 'false')) return false; return null; }
    if (isOp(toks[s], '!')) { var x = constValue(S, s + 1, e, (depthGuard || 0) + 1); return x === null ? null : !x; }
    for (var k = s; k < e; k++) {
      var t = toks[k];
      if (t.type === 'op' && CMP_OPS[t.value] && !S.flags.gen[k]) {
        var l = numLit(S, s, k), r = numLit(S, k + 1, e);
        if (l === null || r === null) {
          var lb = e - s === 3 && (isKw(toks[s], 'true') || isKw(toks[s], 'false')) && (isKw(toks[e - 1], 'true') || isKw(toks[e - 1], 'false'));
          if (lb && (t.value === '==' || t.value === '!=')) return (toks[s].value === toks[e - 1].value) === (t.value === '==');
          return null;
        }
        switch (t.value) {
          case '==': return l === r;
          case '!=': return l !== r;
          case '<': return l < r;
          case '>': return l > r;
          case '<=': return l <= r;
          case '>=': return l >= r;
        }
      }
    }
    return null;
  }

  function splitOps(S, s, e, op) {
    var toks = S.toks, parts = [], depth = 0, ps = s;
    for (var k = s; k < e; k++) {
      var t = toks[k];
      if (t.type === 'punct') {
        if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
        else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
      } else if (depth === 0 && t.type === 'op' && t.value === op) { parts.push({ start: ps, end: k }); ps = k + 1; }
    }
    parts.push({ start: ps, end: e });
    return parts;
  }

  function makeCond(M, S, b, s, e) {
    var toks = S.toks, hasCmp = false;
    for (var k = s; k < e; k++) {
      var t = toks[k];
      if (t.type === 'op' && CMP_OPS[t.value] && !S.flags.gen[k]) { hasCmp = true; break; }
    }
    var cv = e > s ? constValue(S, s, e, 0) : true;
    var c = { nodeType: 'cond', id: M.conds.length, block: b, start: s, end: e, text: S.TX.compact(s, e),
      line: e > s ? toks[s].line : b.headerLine, hasComparison: hasCmp, constantFalse: cv === false, constantTrue: cv === true,
      negated: false, caseLabel: false, dead: false, reachable: false, live: false };
    M.conds.push(c);
    return c;
  }

  function condsPass(M, S) {
    var toks = S.toks;
    for (var bi = 1; bi < M.blocks.length; bi++) {
      var b = M.blocks[bi], o = b.parenOpen, c = b.parenClose;
      if (o < 0 || c < 0) continue;
      if (b.kind === 'if' || b.kind === 'while' || b.kind === 'switch' || b.kind === 'do') b.cond = makeCond(M, S, b, o + 1, c);
      else if (b.kind === 'for') {
        var semis = [], depth = 0;
        for (var k = o + 1; k < c; k++) {
          var t = toks[k];
          if (isP(t, '(') || isP(t, '[') || isP(t, '{')) depth++;
          else if (isP(t, ')') || isP(t, ']') || isP(t, '}')) depth--;
          else if (depth === 0 && isP(t, ';')) semis.push(k);
        }
        if (semis.length >= 2) b.cond = makeCond(M, S, b, semis[0] + 1, semis[1]);
        else if (semis.length === 1) b.cond = makeCond(M, S, b, semis[0] + 1, c);
      }
    }
  }

  // ── Loops ──────────────────────────────────────────────────────────────────
  function condIsControlLoop(S, cond) {
    var toks = S.toks;
    if (cond.end <= cond.start) return true;                  // for (;;)
    for (var k = cond.start; k < cond.end; k++) {
      var t = toks[k];
      if (t.type === 'ident' && t.value === 'opModeIsActive' && isP(toks[k + 1], '(')) return true;
      if (isOp(t, '!') && toks[k + 1] && toks[k + 1].value === 'isStopRequested') return true;
      if (isKw(t, 'true')) return true;
    }
    return false;
  }

  function isOpModeType(S, T, seen) {
    if (!T) return false;
    if (T._opMode !== undefined) return T._opMode;
    seen = seen || [];
    if (seen.indexOf(T) >= 0) return false;
    seen.push(T);
    var r = false;
    if (T.extendsName && OPMODE_BASES[T.extendsName]) r = true;
    else if (T.extendsName && S.typeByName[T.extendsName] && S.typeByName[T.extendsName] !== T) r = isOpModeType(S, S.typeByName[T.extendsName], seen);
    T._opMode = r;
    return r;
  }

  function loopsPass(M, S) {
    S.loopBodies = [];
    for (var bi = 1; bi < M.blocks.length; bi++) {
      var b = M.blocks[bi];
      if ((b.kind === 'while' || b.kind === 'do' || b.kind === 'for') && b.cond && condIsControlLoop(S, b.cond)) {
        b.loop = true; b.controlLoop = true; S.loopBodies.push(b);
      }
    }
    M.methods.forEach(function (m) {
      if (m.name === 'loop' && m.block && !m.anonymous && m.owner && isOpModeType(S, m.owner)) {
        m.block.loop = true; S.loopBodies.push(m.block);
      }
    });
    S.loopBodies.sort(function (a, b) { return a.open - b.open; });
    // Lambdas and anonymous classes passed as call arguments
    for (var li = 1; li < M.blocks.length; li++) {
      var lb = M.blocks[li];
      if (lb.kind !== 'lambda' && lb.kind !== 'anon') continue;
      var at = lb.kind === 'anon' && lb.newIdx != null ? lb.newIdx : lb.header.start;
      var best = null, bestStart = -1, bestIdx = -1;
      for (var ci = 0; ci < M.calls.length; ci++) {
        var c = M.calls[ci];
        if (c.start > at || c.end <= at) continue;
        for (var ai = 0; ai < c.args.length; ai++) {
          var a = c.args[ai];
          if (a.start <= at && at < a.end && a.start > bestStart) { best = c; bestStart = a.start; bestIdx = ai; }
        }
      }
      if (best) {
        lb.argOf = best; lb.argIndex = bestIdx;
        if (best.name === 'setExecute' || best.name === 'infinite') lb.loop = true;
      }
    }
  }

  // ── Dead code ──────────────────────────────────────────────────────────────
  function elseChainConds(b) {
    var out = [], x = b.elseOf, guard = 0;
    while (x && guard++ < 1000) {
      if (x.cond) {
        if (!x.cond._neg) {
          var nc = {}; for (var k in x.cond) if (Object.prototype.hasOwnProperty.call(x.cond, k) && k !== '_neg') nc[k] = x.cond[k];
          nc.negated = true; nc.of = x.cond; x.cond._neg = nc;
        }
        out.push(x.cond._neg);
      }
      x = x.elseOf;
    }
    return out;
  }

  function deadPass(M, S) {
    var root = M.blocks[0];
    markStatements(root);
    S.blockOrder.forEach(function (b) {
      var p = b.parent || root;
      var dead = p.dead || !!(b.ownerStmt && b.ownerStmt.dead);
      if (!dead && b.cond && b.cond.constantFalse && (b.kind === 'if' || b.kind === 'while' || b.kind === 'for')) dead = true;
      if (!dead && b.elseOf) {
        var x = b.elseOf, guard = 0;
        while (x && guard++ < 1000) { if (x.cond && x.cond.constantTrue) { dead = true; break; } x = x.elseOf; }
      }
      b.dead = dead;
      markStatements(b);
    });
    function markStatements(b) {
      var jumped = false;
      b.statements.forEach(function (st) {
        if (b.kind === 'switch' && st.kind === 'label' && st.isCase) jumped = false;
        st.dead = b.dead || jumped;
        if (st.kind === 'return' || st.kind === 'break' || st.kind === 'continue' || st.kind === 'throw') jumped = true;
      });
    }
  }

  // ── Resolution helpers ─────────────────────────────────────────────────────
  function typeByName(S, name) { return name ? S.typeByName[name] || null : null; }
  function userSuper(S, T) { var s = T && T.extendsName ? S.typeByName[T.extendsName] : null; return s && s !== T ? s : null; }
  function hierarchy(S, T) {
    var out = [], guard = 0;
    while (T && out.indexOf(T) < 0 && guard++ < 50) { out.push(T); T = userSuper(S, T); }
    return out;
  }
  function methodsInHierarchy(S, T, name) {
    var out = [];
    hierarchy(S, T).forEach(function (t) { t.methods.forEach(function (m) { if (m.name === name && !m.isCtor) out.push(m); }); });
    return out;
  }
  function fieldInHierarchy(S, T, name) {
    var h = hierarchy(S, T);
    for (var i = 0; i < h.length; i++) for (var j = 0; j < h[i].fields.length; j++) if (h[i].fields[j].name === name) return h[i].fields[j];
    return null;
  }
  function methodsByName(M, name) { return M.methods.filter(function (m) { return m.name === name && !m.isCtor; }); }
  function declType(d) { return d ? (d.inferredType || d.type) : null; }

  function declOf(M, S, name, at) {
    var list = S.declsByName ? S.declsByName[name] : null;
    if (!list || !list.length) return null;
    if (at == null || at < 0) {
      for (var i = 0; i < list.length; i++) if (list[i].scope === 'field') return list[i];
      return list[0];
    }
    var best = null;
    for (var k = 0; k < list.length; k++) {
      var d = list[k];
      if (d.scope === 'field' || d.scope === 'enum') continue;
      if (at < d.scopeStart || at > d.scopeEnd) continue;
      if (d.scope === 'local' && at < d.index) continue;
      if (!best || d.scopeStart > best.scopeStart || (d.scopeStart === best.scopeStart && d.index > best.index)) best = d;
    }
    if (best) return best;
    for (var f = 0; f < list.length; f++) {
      var fd = list[f];
      if (fd.scope !== 'field' && fd.scope !== 'enum') continue;
      if (fd.block && at >= fd.block.open && at <= fd.block.close) {
        if (!best || fd.block.open > best.block.open) best = fd;
      }
    }
    if (best) return best;
    var b = M.blocks[S.tokBlock[at]] || M.blocks[0];
    for (var T = b.typeRef; T; T = T.outer) {
      var fh = fieldInHierarchy(S, T, name);
      if (fh) return fh.decl;
    }
    return null;
  }

  function resolveTargets(M, S, c) {
    if (c.ctorCall) {
      var T0 = c.type;
      if (!T0) return { methods: [], how: 'type' };
      var tgt = c.name === 'super' ? userSuper(S, T0) : T0;
      return { methods: tgt ? tgt.methods.filter(function (m) { return m.isCtor; }) : [], how: 'type', type: tgt };
    }
    if (c.receiverText === '' || c.receiverText === 'this') {
      for (var T = c.type; T; T = T.outer) {
        var own = methodsInHierarchy(S, T, c.name);
        if (own.length) return { methods: own, how: 'type', type: T };
      }
      return { methods: methodsByName(M, c.name), how: 'name' };
    }
    if (!c.receiverIsCall && !c.receiverIsNew && c.receiverChain.length) {
      var chain = c.receiverChain, root = chain[0], R = null;
      if (root === 'super') R = c.type ? userSuper(S, c.type) : null;
      else {
        var d = declOf(M, S, root, c.start);
        if (d) { R = typeByName(S, declType(d)); if (!R) return { methods: methodsByName(M, c.name), how: 'external' }; }
        else if (typeByName(S, root)) R = typeByName(S, root);
        else return { methods: methodsByName(M, c.name), how: 'name' };
      }
      for (var k = 1; R && k < chain.length; k++) {
        var f = fieldInHierarchy(S, R, chain[k]);
        if (!f) { R = null; break; }
        var R2 = typeByName(S, f.type);
        if (!R2) return { methods: methodsByName(M, c.name), how: 'external' };
        R = R2;
      }
      if (R) {
        var ms = methodsInHierarchy(S, R, c.name);
        if (ms.length) return { methods: ms, how: 'type', type: R };
      }
      return { methods: methodsByName(M, c.name), how: 'name' };
    }
    if (c.receiverIsNew) {
      var NT = typeByName(S, c.rootIdent);
      if (NT) { var nm = methodsInHierarchy(S, NT, c.name); if (nm.length) return { methods: nm, how: 'type', type: NT }; }
    }
    return { methods: methodsByName(M, c.name), how: 'name' };
  }

  function ctxOfIndex(M, S, i) {
    var b = M.blocks[S.tokBlock[i]] || M.blocks[0];
    if (b.methodRef) return b.methodRef;
    if (b.typeRef) return b.typeRef.initCtx;
    return S.rootCtx;
  }

  // ── Reachability ───────────────────────────────────────────────────────────
  function reachPass(M, S) {
    var byCtx = new Map();
    function items(ctx) { var it = byCtx.get(ctx); if (!it) { it = { calls: [], news: [], refs: [], anon: [] }; byCtx.set(ctx, it); } return it; }
    M.calls.forEach(function (c) { var b = c.block; c.method = b.methodRef; c.type = b.typeRef; items(ctxOfIndex(M, S, c.start)).calls.push(c); });
    M.news.forEach(function (w) { var b = w.block; w.method = b.methodRef; w.type = b.typeRef; items(ctxOfIndex(M, S, w.start)).news.push(w); });
    M.methodRefs.forEach(function (r) { items(ctxOfIndex(M, S, r.index)).refs.push(r); });
    M.methods.forEach(function (m) {
      if (!m.anonymous || !m.block) return;
      var p = m.block.parent;
      m.enclosingCtx = p ? (p.methodRef || (p.typeRef ? p.typeRef.initCtx : S.rootCtx)) : S.rootCtx;
      items(m.enclosingCtx).anon.push(m);
    });
    var queue = [];
    function mark(ctx) { if (ctx && !ctx.reachable) { ctx.reachable = true; queue.push(ctx); } }
    function markType(T) {
      if (!T || T.initCtx.reachable) return;
      mark(T.initCtx);
      hierarchy(S, T).forEach(function (h) {
        mark(h.initCtx);
        h.methods.forEach(function (m) { if (m.annotations.indexOf('Override') >= 0 || m.isCtor && h !== T) mark(m); });
      });
    }
    var opModes = M.types.filter(function (T) { return isOpModeType(S, T); });
    S.opModeTypes = opModes;
    S.entryMethods = [];
    if (opModes.length) {
      opModes.forEach(function (T) {
        markType(T);
        T.methods.forEach(function (m) { if (ENTRY_NAMES[m.name] && !m.isCtor) { S.entryMethods.push(m); mark(m); } });
      });
    } else {
      mark(S.rootCtx);
      M.types.forEach(markType);
      M.methods.forEach(function (m) { if (!m.anonymous) { S.entryMethods.push(m); mark(m); } });
    }
    M.types.forEach(function (T) {                               // enum constants are built on class load
      if (T.kind === 'enum') { markType(T); T.methods.forEach(function (m) { if (m.isCtor) mark(m); }); }
    });
    var guard = 0;
    while (queue.length && guard++ < 100000) {
      var ctx = queue.shift(), it = byCtx.get(ctx);
      if (!it) continue;
      it.calls.forEach(function (c) { resolveTargets(M, S, c).methods.forEach(mark); });
      it.news.forEach(function (w) {
        var T = typeByName(S, w.typeName);
        if (T && !w.isArray) { markType(T); T.methods.forEach(function (m) { if (m.isCtor) mark(m); }); }
      });
      it.refs.forEach(function (r) {
        if (r.name === 'new') { var RT = typeByName(S, r.receiverText); if (RT) { markType(RT); RT.methods.forEach(function (m) { if (m.isCtor) mark(m); }); } }
        else methodsByName(M, r.name).forEach(mark);
      });
      it.anon.forEach(mark);
    }
  }

  // ── Per-node context: loops, conditions, dead, reachable ───────────────────
  function blockLoopInfo(b) {
    var inLoop = false, depth = 0;
    for (var x = b; x && x.kind !== 'root'; x = x.parent) {
      if (x.loop) inLoop = true;
      if (x.loop || x.iterates) depth++;
      if (x.kind === 'type') break;
    }
    return { inLoop: inLoop, loopDepth: depth };
  }

  function condChainAt(M, S, i) {
    var chain = [];
    var sid = S.tokStmt[i], st = sid >= 0 ? M.statements[sid] : null;
    var b = M.blocks[S.tokBlock[i]] || M.blocks[0];
    if (st && st.caseCond && st.block === b && !st.isCase) chain.push(st.caseCond);
    var guard = 0;
    while (b && !COND_BOUNDARY[b.kind] && guard++ < 100000) {
      if (b.cond && !(b.cond.start <= i && i < b.cond.end)) chain.push(b.cond);
      if (b.elseOf) Array.prototype.push.apply(chain, elseChainConds(b));
      if (b.caseCond) chain.push(b.caseCond);
      b = b.parent;
    }
    return chain;
  }

  function deadAt(M, S, i) {
    var sid = S.tokStmt[i];
    if (sid >= 0 && M.statements[sid].dead) return true;
    var b = M.blocks[S.tokBlock[i]] || M.blocks[0];
    return !!b.dead;
  }

  function contextPass(M, S) {
    var infoCache = new Map();
    function info(b) { var r = infoCache.get(b); if (!r) { r = blockLoopInfo(b); infoCache.set(b, r); } return r; }
    M.calls.forEach(function (c) {
      var li = info(c.block);
      c.inLoop = li.inLoop; c.loopDepth = li.loopDepth;
      c.condChain = condChainAt(M, S, c.start);
      c.dead = deadAt(M, S, c.start);
      c.reachable = !!ctxOfIndex(M, S, c.start).reachable;
      c.live = c.reachable && !c.dead;
      var sid = S.tokStmt[c.start]; c.statement = sid >= 0 ? M.statements[sid] : null;
    });
    M.assigns.forEach(function (a) {
      a.method = a.block.methodRef; a.type = a.block.typeRef;
      a.dead = deadAt(M, S, a.index);
      a.reachable = !!ctxOfIndex(M, S, a.index).reachable;
      a.live = a.reachable && !a.dead;
      var li = info(a.block); a.inLoop = li.inLoop;
      var sid = S.tokStmt[a.index]; a.statement = sid >= 0 ? M.statements[sid] : null;
    });
    M.news.forEach(function (w) {
      w.dead = deadAt(M, S, w.start);
      w.reachable = !!ctxOfIndex(M, S, w.start).reachable;
      w.live = w.reachable && !w.dead;
    });
    M.conds.forEach(function (c) {
      var at = c.end > c.start ? c.start : Math.max(0, c.block.header.start);
      c.dead = c.block.parent ? !!(c.block.parent.dead || (c.block.ownerStmt && c.block.ownerStmt.dead)) : false;
      c.reachable = !!ctxOfIndex(M, S, at).reachable;
      c.live = c.reachable && !c.dead;
      c.method = c.block.methodRef;
    });
    M.cases.forEach(function (c) {
      c.dead = deadAt(M, S, c.start);
      c.reachable = !!ctxOfIndex(M, S, c.start).reachable;
      c.live = c.reachable && !c.dead;
    });
    M.statements.forEach(function (st) {
      st.reachable = !!ctxOfIndex(M, S, st.start).reachable;
      st.method = st.block.methodRef;
    });
  }

  // ── Query API ──────────────────────────────────────────────────────────────
  function installApi(M, S) {
    function guard(fn, fallback) {
      return function () {
        try { return fn.apply(null, arguments); }
        catch (e) {
          if (window.__RT_JSTRUCT_DEBUG) throw e;                  // tests: surface query bugs instead of hiding them
          return typeof fallback === 'function' ? fallback() : fallback;
        }
      };
    }
    function nodeIndex(node) {
      if (node == null) return -1;
      if (typeof node === 'number') return node;
      switch (node.nodeType) {
        case 'call': return node.start;
        case 'assign': case 'decl': case 'field': return node.index;
        case 'block': return node.open;
        case 'method': return node.block ? node.block.open : node.nameIndex;
        case 'type': return node.block ? node.block.open : -1;
        case 'statement': case 'cond': case 'new': return node.start;
        default:
          if (typeof node.i === 'number') return node.i;
          if (typeof node.start === 'number') return node.start;
          if (typeof node.index === 'number') return node.index;
          return -1;
      }
    }
    function rangeOf(x) {
      if (!x) return null;
      if (x.nodeType === 'block') return { start: x.open, end: x.close + 1 };
      if (x.nodeType === 'method') return x.block ? { start: x.block.open, end: x.block.close + 1 } : null;
      if (x.nodeType === 'type') return x.block ? { start: x.block.open, end: x.block.close + 1 } : null;
      if (typeof x.start === 'number' && typeof x.end === 'number') return { start: x.start, end: x.end };
      return null;
    }
    function within(node, target) {
      var i = nodeIndex(node);
      if (i < 0 || !target) return false;
      if (Array.isArray(target)) return target.some(function (t) { return within(i, t); });
      var r = rangeOf(target);
      return !!r && i >= r.start && i < r.end;
    }
    function typeArg(t) { return typeof t === 'string' ? M.typeNamed(t) : t; }
    function asRegex(x) { return isRegex(x) ? x : new RegExp('^' + String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'); }

    M.lineText = guard(function (n) {
      if (S.lines) return n >= 1 && n <= S.lines.length ? S.lines[n - 1].replace(/\r$/, '') : '';
      return M.tokens.filter(function (t) { return t.line === n && t.type !== 'eof'; }).map(tokText).join(' ');
    }, '');
    M.textOf = guard(function (r) { return r ? S.TX.compact(r.start, r.end) : ''; }, '');
    M.rawText = guard(function (r) { return r && M.src != null ? M.src.slice(M.tokens[r.start].start, M.tokens[Math.max(r.start, r.end - 1)].end) : ''; }, '');
    M.blockAt = guard(function (i) { return M.blocks[S.tokBlock[nodeIndex(i)]] || M.blocks[0] || null; }, null);
    M.statementAt = guard(function (i) { var s = S.tokStmt[nodeIndex(i)]; return s >= 0 ? M.statements[s] : null; }, null);
    M.callAt = guard(function (i) { return S.callAt[nodeIndex(i)] || null; }, null);
    M.within = guard(within, false);
    M.typeNamed = guard(function (name) { return S.typeByName[name] || null; }, null);
    M.typesExtending = guard(function (re) {
      var rx = asRegex(re);
      return M.types.filter(function (T) {
        return hierarchy(S, T).some(function (h) { return (h.extends && rx.test(h.extends)) || (h.extendsName && rx.test(h.extendsName)); });
      });
    }, function () { return []; });
    M.methodsNamed = guard(function (name) {
      return M.methods.filter(function (m) { return isRegex(name) ? name.test(m.name) : m.name === name; });
    }, function () { return []; });
    M.methodsOf = guard(function (t) { var T = typeArg(t); return T ? T.methods.slice() : []; }, function () { return []; });
    M.fieldsOf = guard(function (t) { var T = typeArg(t); return T ? T.fields.slice() : []; }, function () { return []; });
    M.fieldsOfType = guard(function (re, t) {
      var rx = asRegex(re), T = t ? typeArg(t) : null;
      return (T ? T.fields : M.fields).filter(function (f) { return (f.typeText && rx.test(f.typeText)) || (f.type && rx.test(f.type)); });
    }, function () { return []; });
    M.varsOfType = guard(function (re) {
      var rx = asRegex(re);
      return M.decls.filter(function (d) { var ty = d.inferredType || d.type; return (d.typeText && rx.test(d.typeText)) || (ty && rx.test(ty)); });
    }, function () { return []; });
    M.declOf = guard(function (name, at) { return declOf(M, S, name, at == null ? null : nodeIndex(at)); }, null);
    M.isDeclared = guard(function (name, at) {
      if (at == null) return !!(S.declsByName && S.declsByName[name] && S.declsByName[name].length);
      return !!declOf(M, S, name, nodeIndex(at));
    }, false);
    M.typeOfVar = guard(function (name, at) {
      var d = declOf(M, S, name, at == null ? null : nodeIndex(at));
      if (!d) return null;
      return d.typeText === 'var' && d.inferredType ? d.inferredType : d.typeText;
    }, null);
    M.resolveCall = guard(function (c) { return resolveTargets(M, S, c); }, function () { return { methods: [], how: 'name' }; });
    M.callsNamed = guard(function (name, opts) {
      opts = opts || {};
      var list = isRegex(name) ? M.calls.filter(function (c) { return name.test(c.name); }) : ((S.callsByName && S.callsByName[name]) || []);
      return list.filter(function (c) {
        if (opts.receiver != null) {
          var r = opts.receiver;
          if (r === '') { if (c.receiverText !== '') return false; }
          else if (c.receiverChain.join('.') !== r && c.receiverText !== r && c.receiverChain[c.receiverChain.length - 1] !== r) return false;
        }
        if (opts.receiverRegex && !opts.receiverRegex.test(c.receiverText)) return false;
        if (opts.chainRoot !== undefined && c.chainRoot !== opts.chainRoot) return false;
        if (opts.within && !within(c, opts.within)) return false;
        if (opts.inLoop !== undefined && !!c.inLoop !== !!opts.inLoop) return false;
        if (opts.live !== undefined && !!c.live !== !!opts.live) return false;
        return true;
      });
    }, function () { return []; });
    M.callsIn = guard(function (x, opts) {
      var hops = typeof opts === 'number' ? opts : (opts && (opts.transitive === true ? 2 : opts.transitive)) || 0;
      var r = rangeOf(x);
      var out = [], via = [], seen = new Set(), visited = new Set();
      if (!r) { out.via = via; return out; }
      if (x.nodeType === 'method') visited.add(x);
      else { var b0 = M.blocks[S.tokBlock[r.start]]; if (b0 && b0.methodRef && b0.kind === 'method') visited.add(b0.methodRef); }
      var frontier = [];
      M.calls.forEach(function (c) {
        if (c.start >= r.start && c.start < r.end && !seen.has(c)) { seen.add(c); out.push(c); via.push({ hops: 0, through: null }); frontier.push({ call: c, through: c }); }
      });
      for (var h = 1; h <= hops && frontier.length; h++) {
        var next = [];
        frontier.forEach(function (fc) {
          var res = resolveTargets(M, S, fc.call);
          if (res.how === 'external') return;
          res.methods.forEach(function (m) {
            if (!m.block || visited.has(m)) return;
            visited.add(m);
            M.calls.forEach(function (c) {
              if (c.start > m.block.open && c.start < m.block.close && !seen.has(c)) {
                seen.add(c); out.push(c); via.push({ hops: h, through: fc.through, method: m }); next.push({ call: c, through: fc.through });
              }
            });
          });
        });
        frontier = next;
      }
      out.via = via;
      return out;
    }, function () { var a = []; a.via = []; return a; });
    M.entryMethods = guard(function () { return (S.entryMethods || []).slice(); }, function () { return []; });
    M.loopBodies = guard(function () { return (S.loopBodies || []).slice(); }, function () { return []; });
    M.initBodies = guard(function () {
      if (S._init) return S._init.slice();
      var out = [];
      M.methods.forEach(function (m) {
        if (!m.block || m.anonymous) return;
        var b = m.block;
        if (m.name === 'runOpMode') {
          var cut = b.close;
          M.calls.forEach(function (c) { if (c.name === 'waitForStart' && c.start > b.open && c.start < cut) cut = c.chainStart; });
          (S.loopBodies || []).forEach(function (lb) {
            var hs = lb.ownerStmt ? lb.ownerStmt.start : lb.header.start;
            if (lb.open > b.open && lb.close <= b.close && hs < cut) cut = hs;
          });
          out.push({ kind: 'runOpMode', method: m, block: b, start: b.open + 1, end: cut,
            statements: b.statements.filter(function (st) { return st.start < cut; }) });
        } else if (m.isCtor || m.name === 'init' || m.name === 'init_loop' || m.name === 'start') {
          out.push({ kind: m.isCtor ? 'ctor' : m.name, method: m, block: b, start: b.open + 1, end: b.close, statements: b.statements.slice() });
        }
      });
      S._init = out;
      return out.slice();
    }, function () { return []; });
    M.inInit = guard(function (node) { var i = nodeIndex(node); return M.initBodies().some(function (r) { return i >= r.start && i < r.end; }); }, false);
    M.inLoopBody = guard(function (node) { var i = nodeIndex(node); return (S.loopBodies || []).some(function (b) { return i > b.open && i <= b.close || (b.braceless && i >= b.open && i <= b.close); }); }, false);
    M.enclosing = guard(function (node) {
      var i = nodeIndex(node);
      var b = node && node.nodeType === 'block' ? node : (M.blocks[S.tokBlock[i]] || M.blocks[0]);
      var li = blockLoopInfo(b);
      var ctx = i >= 0 ? ctxOfIndex(M, S, i) : S.rootCtx;
      return { type: b.typeRef, method: b.methodRef, block: b, loopDepth: li.loopDepth, inLoop: li.inLoop, condChain: i >= 0 ? condChainAt(M, S, i) : [],
        dead: i >= 0 ? deadAt(M, S, i) : false, reachable: !!(ctx && ctx.reachable) };
    }, null);
    M.after = guard(function (block) {
      var b = block && block.nodeType === 'method' ? block.block : block;
      if (!b || !b.parent) return [];
      var own = b.ownerStmt;
      var list = b.parent.statements;
      var k = own ? list.indexOf(own) : -1;
      if (k < 0) return list.filter(function (st) { return st.start > b.close; });
      return list.slice(k + 1);
    }, function () { return []; });
    M.flowsTo = guard(function (pred, sink, opts) {
      opts = opts || {};
      var method = sink.method !== undefined ? sink.method : (M.blocks[S.tokBlock[sink.start]] || M.blocks[0]).methodRef;
      var r = explore(M, S, { start: sink.start, end: sink.end }, method, opts.maxHops == null ? 3 : opts.maxHops, opts.crossMethod !== false, pred);
      return r;
    }, function () { return { ok: false, hops: Infinity, via: [] }; });
    M.exprSources = guard(function (range, method, maxHops) {
      var m = method !== undefined ? method : (M.blocks[S.tokBlock[range.start]] || M.blocks[0]).methodRef;
      return explore(M, S, { start: range.start, end: range.end }, m, maxHops == null ? 3 : maxHops, true, null);
    }, function () { return []; });
  }

  // Bounded breadth-first walk from a token range back to the expressions that feed it.
  function explore(M, S, range, method, maxHops, crossMethod, pred) {
    var toks = S.toks, visited = new Set(), seenRange = new Set(), out = [];
    var frontier = [{ start: range.start, end: range.end, method: method || null, hops: 0, via: [], crossed: false }];
    while (frontier.length) {
      var next = [];
      for (var fi = 0; fi < frontier.length; fi++) {
        var item = frontier[fi], key = item.start + ':' + item.end;
        if (seenRange.has(key)) continue;
        seenRange.add(key);
        out.push(item);
        if (pred) {
          for (var i = item.start; i < item.end && i < S.n; i++) {
            if (pred(toks[i], S.callAt[i] || null)) return { ok: true, hops: item.hops, via: item.via, at: i };
          }
        }
        if (item.hops >= maxHops) continue;
        var useLine = toks[Math.max(item.start, Math.min(item.end - 1, S.n - 1))].line;
        for (var j = item.start; j < item.end && j < S.n; j++) {
          var t = toks[j];
          if (!isIdentLike(t)) continue;
          if (isP(toks[j + 1], '(')) continue;
          var pv = toks[j - 1];
          if (pv && isP(pv, '.') && !isKw(toks[j - 2], 'this')) continue;
          if (pv && isOp(pv, '::')) continue;
          var d = declOf(M, S, t.value, j);
          if (!d || visited.has(d)) continue;
          visited.add(d);
          sourcesOf(d, item, useLine).forEach(function (src) {
            next.push({ start: src.start, end: src.end, method: src.method, hops: item.hops + 1, crossed: item.crossed,
              via: item.via.concat([{ name: d.name, kind: src.kind, line: src.line, start: src.start, end: src.end }]) });
          });
        }
        if (crossMethod && !item.crossed) {
          for (var k = item.start; k < item.end && k < S.n; k++) {
            var c = S.callAt[k];
            if (!c) continue;
            var res = resolveTargets(M, S, c);
            if (res.how === 'external') continue;
            res.methods.forEach(function (m) {
              if (!m.block || m === item.method) return;
              returnRanges(m).forEach(function (rr) {
                next.push({ start: rr.start, end: rr.end, method: m, hops: item.hops + 1, crossed: true,
                  via: item.via.concat([{ name: m.name, kind: 'return', line: rr.line, start: rr.start, end: rr.end }]) });
              });
            });
          }
        }
      }
      frontier = next;
    }
    return pred ? { ok: false, hops: Infinity, via: [] } : out;

    function sourcesOf(d, item, useLine) {
      var list = [];
      if (d.init) list.push({ start: d.init.start, end: d.init.end, kind: 'decl', line: d.line, method: d.method || item.method });
      var cands = (S.assignsByBase && S.assignsByBase[d.name]) || [];
      var inits = d.scope === 'field' ? M.initBodies() : null;
      cands.forEach(function (a) {
        if (declOf(M, S, d.name, a.index) !== d) return;
        var ok = a.block.methodRef === item.method && a.line <= useLine;
        if (!ok && d.scope === 'field') {
          var am = a.block.methodRef;
          ok = !!(am && am.isCtor) || inits.some(function (r) { return a.index >= r.start && a.index < r.end; });
        }
        if (ok) list.push({ start: a.rhs.start, end: a.rhs.end, kind: 'assign', line: a.line, method: a.block.methodRef });
      });
      return list;
    }
    function returnRanges(m) {
      var out2 = [];
      M.statements.forEach(function (st) {
        if (st.kind !== 'return' || st.start <= m.block.open || st.start >= m.block.close) return;
        if (st.block.methodRef !== m) return;
        var ownerLambda = false;
        for (var b = st.block; b && b !== m.block; b = b.parent) if (b.kind === 'lambda' || b.kind === 'anon') { ownerLambda = true; break; }
        if (ownerLambda) return;
        var e = isP(toks[st.end - 1], ';') ? st.end - 1 : st.end;
        if (e > st.start + 1) out2.push({ start: st.start + 1, end: e, line: st.line });
      });
      return out2;
    }
  }

  // ── Shingles and coverage ──────────────────────────────────────────────────
  function tokenValues(src) {
    var list = Array.isArray(src) ? src : [src];
    return list.map(function (s) {
      var r = tokenize(typeof s === 'string' ? s : String(s == null ? '' : s));
      var vals = [];
      for (var i = 0; i < r.tokens.length; i++) if (r.tokens[i].type !== 'eof') vals.push(r.tokens[i].value);
      return vals;
    });
  }
  function shingles(src, n) {
    try {
      n = Math.max(1, (n | 0) || 5);
      var out = [];
      tokenValues(src).forEach(function (vals) {
        if (!vals.length) return;
        if (vals.length < n) { out.push(vals.join(' ')); return; }
        for (var i = 0; i + n <= vals.length; i++) out.push(vals.slice(i, i + n).join(' '));
      });
      return out;
    } catch (e) { return []; }
  }
  function coverage(subject, reference, n) {
    try {
      var sub = new Set(shingles(subject, n));
      if (!sub.size) return 0;
      var ref = new Set(shingles(reference, n)), hit = 0;
      sub.forEach(function (s) { if (ref.has(s)) hit++; });
      return hit / sub.size;
    } catch (e) { return 0; }
  }

  window.RTJavaStructure = { VERSION: VERSION, tokenize: tokenize, parse: parse, shingles: shingles, coverage: coverage };

  if (typeof module !== 'undefined' && module.exports) module.exports = window.RTJavaStructure;
})();
