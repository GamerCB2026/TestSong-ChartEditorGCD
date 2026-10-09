/* =====================================================================
   hscript.js — mini intérprete de Haxe / HScript (subconjunto) para los
   scripts .hxc de V-Slice (SongEvent, NoteKind, Module).
   Tokenizador (basado en el de Chart Editor GCD js/NoteEvents.js) + parser
   de clases/métodos + intérprete de árbol. Todo lo que el juego expone
   (PlayState, FlxG, FlxTween…) lo da HOST (mods.js); lo que no existe se
   devuelve como "stub" silencioso y se anota como no soportado.
   Es una IMITACIÓN creada desde 0: no ejecuta Haxe real.
   ===================================================================== */
'use strict';

const HX = (() => {
  const PUNCT = ['>>>=', '...', '>>>', '<<=', '>>=', '??=', '=>', '->', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '??', '?.', '++', '--', '<<', '>>'];
  const DEFINES = { html5: true, js: true, web: true, FEATURE_NAUGHTYNESS: true };

  /* ---------- tokenizador (con #if/#else/#end evaluados: plataforma web) ---------- */
  function evalCond(src) {
    const js = src.replace(/[A-Za-z_][\w.]*/g, m => (DEFINES[m] ? 'true' : 'false'));
    if (/[^\s()!&|truefals]/.test(js)) return false;
    try { return !!Function('return (' + js + ')')(); } catch (e) { return false; }
  }
  function tokenize(src) {
    const T = [], n = src.length, stack = []; let i = 0;
    const active = () => stack.every(s => s.on);
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '\uFEFF') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '#') {
        const m = /^#(if|elseif|else|end|error|line)\b/.exec(src.slice(i, i + 12));
        if (m) {
          i += m[0].length; let cond = '';
          if (m[1] === 'if' || m[1] === 'elseif') {
            while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
            if (src[i] === '!') { cond += '!'; i++; }
            if (src[i] === '(') { let d = 0; const s0 = i; for (; i < n; i++) { if (src[i] === '(') d++; else if (src[i] === ')' && --d === 0) { i++; break; } } cond += src.slice(s0, i); }
            else { const s0 = i; while (i < n && /[\w.]/.test(src[i])) i++; cond += src.slice(s0, i); }
          }
          if (m[1] === 'if') { const v = evalCond(cond); stack.push({ on: v, taken: v }); }
          else if (m[1] === 'elseif') { const s = stack[stack.length - 1]; if (s) { const v = !s.taken && evalCond(cond); s.on = v; s.taken = s.taken || v; } }
          else if (m[1] === 'else') { const s = stack[stack.length - 1]; if (s) { s.on = !s.taken; s.taken = true; } }
          else if (m[1] === 'end') stack.pop();
          else { while (i < n && src[i] !== '\n') i++; }
          continue;
        }
      }
      const on = active();
      if (c === '"' || c === "'") {
        let v = '', j = i + 1;
        while (j < n && src[j] !== c) {
          if (src[j] === '\\' && j + 1 < n) {
            const e = src[j + 1];
            v += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 2, j + 6))) ? (j += 4, String.fromCharCode(parseInt(src.slice(j - 2, j + 2), 16))) : e;
            j += 2; continue;
          }
          v += src[j++];
        }
        if (on) T.push({ t: 'str', v, interp: c === "'" && v.includes('$'), p: i });
        i = j + 1; continue;
      }
      if (c === '~' && src[i + 1] === '/') {
        let j = i + 2, v = '';
        while (j < n && src[j] !== '/') { if (src[j] === '\\') { v += src[j] + src[j + 1]; j += 2; continue; } v += src[j++]; }
        j++; let fl = ''; while (j < n && /[gimsu]/.test(src[j])) fl += src[j++];
        if (on) T.push({ t: 'regex', v, flags: fl, p: i });
        i = j; continue;
      }
      const rest = src.slice(i, i + 64);
      const num = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.(?!\.)\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/.exec(rest);
      if (num && (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || '')))) {
        if (on) T.push({ t: 'num', v: /^0x/i.test(num[0]) ? parseInt(num[0], 16) : parseFloat(num[0]), p: i });
        i += num[0].length; continue;
      }
      const id = /^[A-Za-z_]\w*/.exec(rest);
      if (id) { if (on) T.push({ t: 'id', v: id[0], p: i }); i += id[0].length; continue; }
      const multi = PUNCT.find(s => src.startsWith(s, i));
      if (multi) { if (on) T.push({ t: 'op', v: multi, p: i }); i += multi.length; continue; }
      if (on) T.push({ t: 'op', v: c, p: i });
      i++;
    }
    T.push({ t: 'eof', v: '', p: n });
    return T;
  }

  /* ---------- parser ---------- */
  const BIN = { '??': 3, '||': 4, '&&': 5, '...': 6, '==': 7, '!=': 7, '<': 7, '>': 7, '<=': 7, '>=': 7, '|': 8, '&': 8, '^': 8, '<<': 9, '>>': 9, '>>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11 };
  const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<=', '>>=', '>>>=', '??=']);
  const MODS = new Set(['public', 'private', 'static', 'override', 'inline', 'final', 'dynamic', 'extern', 'macro', 'abstract', 'overload']);
  class Parser {
    constructor(T, src) { this.T = T; this.i = 0; this.src = src; }
    peek(o = 0) { return this.T[Math.min(this.i + o, this.T.length - 1)]; }
    next() { return this.T[this.i < this.T.length - 1 ? this.i++ : this.i]; }
    is(v, o = 0) { const t = this.peek(o); return (t.t === 'op' || t.t === 'id') && t.v === v; }
    isOp(v, o = 0) { const t = this.peek(o); return t.t === 'op' && t.v === v; }
    eat(v) { if (this.is(v)) { this.i++; return true; } return false; }
    expect(v) { if (!this.eat(v)) this.err(`se esperaba "${v}"`); }
    err(msg) { const t = this.peek(); const line = this.src ? this.src.slice(0, t.p).split('\n').length : '?'; const e = new Error(`${msg} (línea ${line}, cerca de "${t.v}")`); e.hx = true; throw e; }
    ident() { const t = this.next(); if (t.t !== 'id') { this.i--; this.err('se esperaba un nombre'); } return t.v; }
    skipBalanced() {   // T[i] es ( [ {
      let d = 0;
      for (; this.i < this.T.length; this.i++) {
        const t = this.T[this.i]; if (t.t !== 'op') continue;
        if (t.v === '(' || t.v === '[' || t.v === '{') d++;
        else if (t.v === ')' || t.v === ']' || t.v === '}') { d--; if (d === 0) { this.i++; return; } }
      }
    }
    skipMeta() { while (this.isOp('@')) { this.i++; this.eat(':'); this.ident(); if (this.isOp('(')) this.skipBalanced(); } }
    /* tipos: Int, Null<Float->Float>, Array<Int>, {x:Int}, (Int)->Void, ?Float */
    skipType() {
      this.eat('?');
      if (this.isOp('(') || this.isOp('{')) this.skipBalanced();
      else {
        if (this.peek().t === 'id') { this.i++; while (this.isOp('.') && this.peek(1).t === 'id') this.i += 2; }
        if (this.isOp('<')) {
          let d = 0;
          for (; this.i < this.T.length; this.i++) {
            const t = this.T[this.i]; if (t.t !== 'op') continue;
            for (const ch of t.v) { if (ch === '<') d++; else if (ch === '>') d--; }
            if (t.v === '->') d++;    // "->" no cierra
            if (d <= 0) { this.i++; break; }
          }
        }
      }
      if (this.isOp('->')) { this.i++; this.skipType(); }
    }
    /* archivo: imports + clases */
    file() {
      const out = { imports: [], classes: [], errors: [] };
      while (this.peek().t !== 'eof') {
        if (this.eat('package')) { while (!this.isOp(';') && this.peek().t !== 'eof') this.i++; this.eat(';'); continue; }
        if (this.is('import') || this.is('using')) {
          this.i++; let p = ''; while (!this.isOp(';') && this.peek().t !== 'eof') { const t = this.next(); p += t.v; } this.eat(';');
          const m = /^(.*?)(?:as|in)(\w+)$/.exec(p); out.imports.push(m && !/\./.test(m[2]) ? { path: m[1], alias: m[2] } : { path: p, alias: p.split('.').pop() });
          continue;
        }
        this.skipMeta();
        while (this.peek().t === 'id' && MODS.has(this.peek().v)) this.i++;
        if (this.eat('class')) { try { out.classes.push(this.classDecl()); } catch (e) { out.errors.push(e.message); this.recoverTop(); } continue; }
        if (this.is('typedef') || this.is('enum') || this.is('interface') || this.is('abstract')) { while (!this.isOp('{') && !this.isOp(';') && this.peek().t !== 'eof') this.i++; if (this.isOp('{')) this.skipBalanced(); else this.i++; continue; }
        this.i++;
      }
      return out;
    }
    recoverTop() { while (this.peek().t !== 'eof' && !this.is('class')) this.i++; }
    classDecl() {
      const name = this.ident(); let parent = '';
      if (this.isOp('<')) this.skipType();
      while (this.is('extends') || this.is('implements')) {
        const kw = this.next().v; let p = this.ident(); while (this.eat('.')) p += '.' + this.ident(); if (this.isOp('<')) { this.i--; this.i++; this.skipType(); }
        if (kw === 'extends') parent = p;
      }
      this.expect('{');
      const cls = { name, parent, fields: [], methods: {}, statics: {}, staticMethods: {}, errors: [], src: [] };
      while (!this.isOp('}') && this.peek().t !== 'eof') {
        const start = this.i;
        try { this.member(cls); }
        catch (e) {
          cls.errors.push(e.message);
          // recuperación: saltar hasta el siguiente miembro
          this.i = start + 1;
          while (this.peek().t !== 'eof' && !this.isOp('}')) {
            if (this.isOp('{')) { this.skipBalanced(); continue; }
            const t = this.peek(); if (t.t === 'id' && (t.v === 'function' || t.v === 'var' || MODS.has(t.v)) && this.T[this.i - 1].t === 'op' && /[;}]/.test(this.T[this.i - 1].v)) break;
            this.i++;
          }
        }
      }
      this.expect('}');
      return cls;
    }
    member(cls) {
      this.skipMeta();
      let isStatic = false;
      while (this.peek().t === 'id' && MODS.has(this.peek().v)) { if (this.peek().v === 'static') isStatic = true; if (this.peek().v === 'final' && (this.peek(1).t === 'id' && !MODS.has(this.peek(1).v) && this.peek(1).v !== 'function' && this.peek(1).v !== 'var')) break; this.i++; }
      this.skipMeta();
      if (this.eat(';')) return;
      if (this.is('var') || this.is('final')) {
        this.i++;
        do {
          const n = this.ident();
          if (this.isOp('(')) this.skipBalanced();   // (get, set)
          if (this.eat(':')) this.skipType();
          const e = this.eat('=') ? this.expr() : null;
          (isStatic ? (cls.statics[n] = { e }) : cls.fields.push({ n, e }));
        } while (this.eat(','));
        this.eat(';');
        return;
      }
      if (this.eat('function')) {
        const n = this.ident();
        const fn = this.fnRest(n);
        (isStatic ? cls.staticMethods : cls.methods)[n] = fn;
        return;
      }
      this.err('miembro de clase no reconocido');
    }
    params() {
      this.expect('('); const ps = [];
      while (!this.isOp(')')) {
        this.skipMeta();
        const opt = this.eat('?'); const n = this.ident();
        if (this.eat(':')) this.skipType();
        const def = this.eat('=') ? this.expr() : null;
        ps.push({ n, opt, def });
        if (!this.eat(',')) break;
      }
      this.expect(')');
      return ps;
    }
    fnRest(name) {
      if (this.isOp('<')) this.skipType();
      const params = this.params();
      if (this.eat(':')) this.skipType();
      if (this.isOp('{')) return { k: 'fn', name, params, body: this.block() };
      if (this.eat(';')) return { k: 'fn', name, params, body: { k: 'block', body: [] } };
      const e = this.expr(); this.eat(';');
      return { k: 'fn', name, params, body: e, exprBody: true };
    }
    block() {
      this.expect('{'); const body = [];
      while (!this.isOp('}') && this.peek().t !== 'eof') body.push(this.stmt());
      this.expect('}');
      return { k: 'block', body };
    }
    stmt() {
      const t = this.peek();
      if (t.t === 'op') {
        if (t.v === '{') { if (this.looksLikeObject()) { const e = this.expr(); this.eat(';'); return e; } return this.block(); }
        if (t.v === ';') { this.i++; return { k: 'block', body: [] }; }
      }
      if (t.t === 'id') {
        switch (t.v) {
          case 'var': case 'final': {
            this.i++; const decls = [];
            do { const n = this.ident(); if (this.eat(':')) this.skipType(); decls.push({ n, e: this.eat('=') ? this.expr() : null }); } while (this.eat(','));
            this.eat(';'); return { k: 'var', decls };
          }
          case 'static': case 'inline': this.i++; return this.stmt();
          case 'while': { this.i++; this.expect('('); const c = this.expr(); this.expect(')'); return { k: 'while', c, body: this.stmt() }; }
          case 'do': { this.i++; const body = this.stmt(); this.expect('while'); this.expect('('); const c = this.expr(); this.expect(')'); this.eat(';'); return { k: 'do', c, body }; }
          case 'for': {
            this.i++; this.expect('('); const v = this.ident(); let v2 = null;
            if (this.eat('=>')) v2 = this.ident();
            this.expect('in'); const it = this.expr(); this.expect(')');
            return { k: 'for', v, v2, it, body: this.stmt() };
          }
          case 'return': { this.i++; if (this.eat(';') || this.isOp('}')) return { k: 'ret', e: null }; const e = this.expr(); this.eat(';'); return { k: 'ret', e }; }
          case 'break': this.i++; this.eat(';'); return { k: 'break' };
          case 'continue': this.i++; this.eat(';'); return { k: 'cont' };
          case 'throw': { this.i++; const e = this.expr(); this.eat(';'); return { k: 'throw', e }; }
          case 'try': {
            this.i++; const body = this.stmt(), catches = [];
            while (this.eat('catch')) { this.expect('('); const n = this.ident(); if (this.eat(':')) this.skipType(); this.expect(')'); catches.push({ n, body: this.stmt() }); }
            return { k: 'try', body, catches };
          }
          case 'function':
            if (this.peek(1).t === 'id') { this.i++; const n = this.ident(); return { k: 'fndecl', name: n, fn: this.fnRest(n) }; }
            break;
        }
      }
      const e = this.expr(); this.eat(';');
      return e;
    }
    looksLikeObject() {
      const a = this.peek(1), b = this.peek(2);
      return (a.t === 'op' && a.v === '}') || ((a.t === 'id' || a.t === 'str') && b.t === 'op' && b.v === ':');
    }
    expr(min = 0) {
      let left = this.unary();
      for (;;) {
        const t = this.peek();
        if (t.t !== 'op') { if (t.t === 'id' && t.v === 'is' && min <= 7) { this.i++; this.skipType(); left = { k: 'lit', v: true, isCheck: left }; continue; } break; }
        if (ASSIGN.has(t.v)) { if (min > 1) break; this.i++; const v = this.expr(1); left = { k: 'assign', op: t.v, t: left, v }; continue; }
        if (t.v === '?') { if (min > 2) break; this.i++; const a = this.expr(0); this.expect(':'); const b = this.expr(2); left = { k: 'tern', c: left, a, b }; continue; }
        const bp = BIN[t.v];
        if (!bp || bp < min) break;
        this.i++;
        const right = this.expr(bp + 1);
        left = { k: 'bin', op: t.v, a: left, b: right };
      }
      return left;
    }
    unary() {
      const t = this.peek();
      if (t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '~' || t.v === '++' || t.v === '--')) { this.i++; return { k: 'un', op: t.v, e: this.unary() }; }
      if (t.t === 'id' && t.v === 'cast') {
        this.i++;
        if (this.isOp('(')) { this.i++; const e = this.expr(); if (this.eat(',')) this.skipType(); this.expect(')'); return this.postfix(e); }
        return this.unary();
      }
      if (t.t === 'id' && t.v === 'untyped') { this.i++; return this.unary(); }
      return this.postfix(this.primary());
    }
    postfix(e) {
      for (;;) {
        const t = this.peek();
        if (t.t !== 'op') break;
        if (t.v === '.') { this.i++; e = { k: 'field', o: e, n: this.ident() }; continue; }
        if (t.v === '?.') { this.i++; if (this.isOp('(')) { e = { k: 'call', f: e, args: this.args(), opt: true }; continue; } if (this.isOp('[')) { this.i++; const ix = this.expr(); this.expect(']'); e = { k: 'index', o: e, i: ix, opt: true }; continue; } e = { k: 'field', o: e, n: this.ident(), opt: true }; continue; }
        if (t.v === '(') { e = { k: 'call', f: e, args: this.args() }; continue; }
        if (t.v === '[') { this.i++; const ix = this.expr(); this.expect(']'); e = { k: 'index', o: e, i: ix }; continue; }
        if (t.v === '++' || t.v === '--') { this.i++; e = { k: 'un', op: t.v, e, post: true }; continue; }
        if (t.v === '!' && this.peek(1).t === 'op' && this.peek(1).v === '.') { this.i++; continue; }   // null-safety "!."
        break;
      }
      return e;
    }
    args() { this.expect('('); const a = []; while (!this.isOp(')')) { a.push(this.expr()); if (!this.eat(',')) break; } this.expect(')'); return a; }
    strNode(t) {
      if (!t.interp) return { k: 'lit', v: t.v };
      const parts = []; const s = t.v; let i = 0, cur = '';
      while (i < s.length) {
        if (s[i] === '$') {
          if (s[i + 1] === '$') { cur += '$'; i += 2; continue; }
          if (s[i + 1] === '{') {
            let d = 0, j = i + 1; for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; }
            if (cur) parts.push(cur); cur = '';
            try { const p = new Parser(tokenize(s.slice(i + 2, j))); parts.push(p.expr()); } catch (e) { parts.push(s.slice(i, j + 1)); }
            i = j + 1; continue;
          }
          const m = /^[A-Za-z_]\w*/.exec(s.slice(i + 1));
          if (m) { if (cur) parts.push(cur); cur = ''; parts.push({ k: 'id', n: m[0] }); i += 1 + m[0].length; continue; }
        }
        cur += s[i++];
      }
      if (cur) parts.push(cur);
      return { k: 'str', parts };
    }
    primary() {
      const t = this.next();
      if (t.t === 'num') return { k: 'lit', v: t.v };
      if (t.t === 'str') return this.strNode(t);
      if (t.t === 'regex') return { k: 'regex', src: t.v, flags: t.flags };
      if (t.t === 'id') {
        switch (t.v) {
          case 'true': return { k: 'lit', v: true };
          case 'false': return { k: 'lit', v: false };
          case 'null': return { k: 'lit', v: null };
          case 'this': return { k: 'this' };
          case 'super': return { k: 'super' };
          case 'function': { const n = this.peek().t === 'id' ? this.ident() : null; return this.fnRest(n); }
          case 'new': {
            let n = this.ident(); while (this.isOp('.') && this.peek(1).t === 'id') { this.i++; n += '.' + this.ident(); }
            if (this.isOp('<')) this.skipType();
            return { k: 'new', cls: n, args: this.args() };
          }
          case 'if': {
            this.expect('('); const c = this.expr(); this.expect(')');
            const a = this.stmtOrExpr(); let b = null;
            const save = this.i; this.eat(';');
            if (this.eat('else')) b = this.stmtOrExpr(); else this.i = save;
            return { k: 'if', c, a, b };
          }
          case 'switch': return this.switchExpr();
          case 'macro': return this.primary();
        }
        if (this.isOp('->')) { this.i++; const body = this.expr(1); return { k: 'fn', params: [{ n: t.v }], body, exprBody: true }; }
        return { k: 'id', n: t.v };
      }
      if (t.t === 'op') {
        if (t.v === '(') {
          // ¿función flecha? (a, b) -> expr
          const s = this.i - 1; this.i = s; this.skipBalanced();
          if (this.isOp('->')) {
            this.i = s; const params = this.params(); this.expect('->');
            const body = this.isOp('{') && !this.looksLikeObject() ? this.block() : this.expr(1);
            return { k: 'fn', params, body, exprBody: body.k !== 'block' };
          }
          this.i = s + 1;
          const e = this.expr(); if (this.eat(':')) this.skipType(); this.expect(')');
          return e;
        }
        if (t.v === '[') {
          const items = []; let pairs = null;
          while (!this.isOp(']')) {
            if (this.is('for')) { this.err('comprensión de arrays no soportada'); }
            const a = this.expr();
            if (this.eat('=>')) { pairs = pairs || []; pairs.push([a, this.expr()]); } else items.push(a);
            if (!this.eat(',')) break;
          }
          this.expect(']');
          return pairs ? { k: 'map', pairs } : { k: 'arr', items };
        }
        if (t.v === '{') {
          this.i--;
          if (this.looksLikeObject()) {
            this.i++; const fields = [];
            while (!this.isOp('}')) { const k = this.next(); this.expect(':'); fields.push([k.v, this.expr()]); if (!this.eat(',')) break; }
            this.expect('}');
            return { k: 'obj', fields };
          }
          return this.block();
        }
        if (t.v === '-' ) return { k: 'un', op: '-', e: this.unary() };
      }
      this.i--; this.err('expresión no reconocida');
    }
    stmtOrExpr() { return this.stmt(); }
    switchExpr() {
      let e;
      if (this.isOp('(')) { this.i++; e = this.expr(); this.expect(')'); } else e = this.expr();
      this.expect('{');
      const cases = []; let def = null;
      while (!this.isOp('}') && this.peek().t !== 'eof') {
        if (this.eat('default')) { this.expect(':'); def = this.caseBody(); continue; }
        this.expect('case');
        const vals = [];
        const flat = x => { if (x.k === 'bin' && x.op === '|') { flat(x.a); flat(x.b); } else vals.push(x); };
        do { flat(this.expr(3)); } while (this.eat(','));
        let guard = null; if (this.eat('if')) { this.expect('('); guard = this.expr(); this.expect(')'); }
        this.expect(':');
        cases.push({ vals, guard, body: this.caseBody() });
      }
      this.expect('}');
      return { k: 'switch', e, cases, def };
    }
    caseBody() { const body = []; while (!this.is('case') && !this.is('default') && !this.isOp('}') && this.peek().t !== 'eof') body.push(this.stmt()); return { k: 'block', body }; }
  }

  /* ---------- valores Haxe ---------- */
  class HxMap {
    constructor(entries) { this.m = new Map(entries || []); }
    get(k) { return this.m.has(k) ? this.m.get(k) : null; }
    set(k, v) { this.m.set(k, v); return v; }
    exists(k) { return this.m.has(k); }
    remove(k) { return this.m.delete(k); }
    keys() { return [...this.m.keys()]; }
    iterator() { return [...this.m.values()]; }
    keyValueIterator() { return [...this.m.entries()]; }
    copy() { return new HxMap(this.m); }
    clear() { this.m.clear(); }
    toString() { return '[' + [...this.m].map(([k, v]) => k + ' => ' + v).join(', ') + ']'; }
  }
  class EReg {
    constructor(src, flags) { this.re = new RegExp(src, (flags || '').replace('g', '')); this.g = new RegExp(src, (flags || '').includes('g') ? flags : (flags || '') + 'g'); this.last = null; }
    match(s) { this.last = this.re.exec(String(s)); return !!this.last; }
    matched(n) { return this.last ? (this.last[n] ?? null) : null; }
    replace(s, by) { return String(s).replace((this.g.flags.includes('g') && this.re.flags !== this.g.flags) ? this.g : this.re, by.replace(/\$(\d)/g, '$$$1')); }
    split(s) { return String(s).split(this.re); }
  }
  class Interval { constructor(a, b) { this.a = a; this.b = b; } }
  class Ret { constructor(v) { this.v = v; } }
  const BRK = { brk: 1 }, CNT = { cnt: 1 };
  class HxThrow extends Error { constructor(v) { super(String(v)); this.value = v; } }

  /* ---------- registro / avisos ---------- */
  const R = { cur: null, notes: new Map() };   // script actual -> Set de textos
  function note(text) {
    const k = R.cur || '(script)';
    if (!R.notes.has(k)) R.notes.set(k, new Set());
    const s = R.notes.get(k); if (s.size < 60) s.add(text);
  }
  const stubCache = new Map();
  function stub(path, silent) {
    const key = (silent ? 's:' : 'n:') + path;
    if (stubCache.has(key)) return stubCache.get(key);
    const target = function () {};
    const p = new Proxy(target, {
      get(t, prop) {
        if (prop === '__stub') return path;
        if (prop === Symbol.toPrimitive) return hint => hint === 'number' ? 0 : (silent ? '' : `[${path}]`);
        if (prop === 'toString' || prop === 'valueOf') return () => (silent ? '' : `[${path}]`);
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        if (typeof prop === 'string' && prop.startsWith('__')) return undefined;   // marcas internas (__hxcls, __hxc, __host…)
        return stub(path + '.' + String(prop), silent);
      },
      set(t, prop) { if (!silent) note(`${path}.${String(prop)} = … (sin efecto)`); return true; },
      apply() { if (!silent) note(`${path}() (sin efecto)`); return stub(path + '()', silent); },
      construct() { if (!silent) note(`new ${path}() (sin efecto)`); return stub('new ' + path, silent); },
    });
    stubCache.set(key, p);
    return p;
  }
  const isStub = v => typeof v === 'function' && !!v.__stub;

  /* ---------- intérprete ---------- */
  const ARRAY_EXT = {
    contains(a) { return x => a.includes(x); }, remove(a) { return x => { const i = a.indexOf(x); if (i < 0) return false; a.splice(i, 1); return true; }; },
    insert(a) { return (i, x) => { a.splice(i, 0, x); }; }, copy(a) { return () => a.slice(); }, iterator(a) { return () => a.slice(); },
    resize(a) { return n => { a.length = n; }; }, keyValueIterator(a) { return () => a.map((v, i) => [i, v]); },
  };
  const STR_EXT = { substr(s) { return (p, l) => l === undefined || l === null ? s.substr(p) : s.substr(p, l); }, charCodeAt(s) { return i => { const c = s.charCodeAt(i); return isNaN(c) ? null : c; }; } };

  class Scope { constructor(parent, self, cls) { this.v = new Map(); this.parent = parent; this.self = self ?? parent?.self ?? null; this.cls = cls ?? parent?.cls ?? null; } }

  class Script {
    constructor(name, src, host) {
      this.name = name; this.src = src; this.host = host; this.classes = new Map(); this.imports = []; this.errors = [];
      const parsed = new Parser(tokenize(src), src).file();
      this.imports = parsed.imports; this.errors = parsed.errors.slice();
      for (const c of parsed.classes) { c.script = this; this.classes.set(c.name, c); this.errors.push(...c.errors.map(e => `${c.name}: ${e}`)); }
      this.alias = new Map(this.imports.map(im => [im.alias, im.path]));
      for (const c of this.classes.values()) this.initStatics(c);
    }
    run(fnLabel, f) {
      const prev = R.cur; R.cur = this.name;
      try { return f(); }
      catch (e) {
        if (e instanceof Ret) return e.v;
        const msg = (e && e.message) || String(e);
        note(`error en ${fnLabel}: ${msg}`);
        console.warn('[hxc]', this.name, fnLabel, e);
        return null;
      } finally { R.cur = prev; }
    }
    findClass(name) { return this.classes.get(name) || this.host.findClass(name); }
    parentOf(cls) { if (!cls.parent) return null; const base = cls.parent.split('.').pop(); const pc = this.findClass(base); return pc && pc !== cls ? pc : null; }
    nativeBase(cls) { let c = cls, d = 0; while (c && d++ < 12) { const p = this.parentOf(c); if (!p) return (c.parent || '').split('.').pop(); c = p; } return ''; }
    findMethod(cls, n) { let c = cls, d = 0; while (c && d++ < 12) { if (c.methods[n]) return { fn: c.methods[n], cls: c }; c = c.script ? c.script.parentOf(c) : null; } return null; }
    initStatics(c) {
      c.staticVals = {};
      const sc = new Scope(null, null, c);
      for (const [n, s] of Object.entries(c.statics)) { try { c.staticVals[n] = s.e ? this.eval(s.e, sc) : null; } catch (e) { c.staticVals[n] = null; } }
    }
    instantiate(cls, args) {
      const obj = {};
      Object.defineProperty(obj, '__hxc', { value: cls, enumerable: false });
      const chain = []; let c = cls; while (c && chain.length < 12) { chain.unshift(c); c = c.script.parentOf(c); }
      for (const k of chain) { const sc = new Scope(null, obj, k); for (const f of k.fields) { try { obj[f.n] = f.e ? k.script.eval(f.e, sc) : null; } catch (e) { obj[f.n] = null; } } }
      const ctor = this.findMethod(cls, 'new');
      if (ctor) this.run(cls.name + '.new', () => ctor.cls.script.invoke(ctor.fn, null, obj, ctor.cls, args || []));
      else this.host.nativeSuper(this.nativeBase(cls), obj, args || []);
      return obj;
    }
    callMethod(obj, n, args) {
      const m = this.findMethod(obj.__hxc, n); if (!m) return undefined;
      return this.run(`${obj.__hxc.name}.${n}`, () => m.cls.script.invoke(m.fn, null, obj, m.cls, args || []));
    }
    mkFunc(fn, scope, self, cls) {
      const s = this;
      const f = function (...args) { return s.invoke(fn, scope, self, cls, args); };
      f.__hxfn = true;
      return f;
    }
    invoke(fn, scope, self, cls, args) {
      const sc = new Scope(scope, self, cls);
      sc.fn = fn;
      (fn.params || []).forEach((p, i) => { let v = args[i]; if ((v === undefined || v === null) && p.def) v = this.eval(p.def, sc); sc.v.set(p.n, v === undefined ? null : v); });
      if (fn.name) sc.v.set('__fnname', fn.name);
      try { const r = this.exec(fn.body, sc); return fn.exprBody ? r : null; }
      catch (e) { if (e instanceof Ret) return e.v; throw e; }
    }
    /* ---- sentencias ---- */
    exec(node, sc) {
      if (!node) return null;
      switch (node.k) {
        case 'block': { const s2 = new Scope(sc); let r = null; for (const st of node.body) r = this.exec(st, s2); return r; }
        case 'var': for (const d of node.decls) sc.v.set(d.n, d.e ? this.eval(d.e, sc) : null); return null;
        case 'fndecl': { const f = this.mkFunc(node.fn, sc, sc.self, sc.cls); sc.v.set(node.name, f); return null; }
        case 'while': { let guard = 0; while (this.truthy(this.eval(node.c, sc))) { if (++guard > 1e6) throw new Error('bucle infinito'); try { this.exec(node.body, sc); } catch (e) { if (e === BRK) break; if (e === CNT) continue; throw e; } } return null; }
        case 'do': { let guard = 0; do { if (++guard > 1e6) throw new Error('bucle infinito'); try { this.exec(node.body, sc); } catch (e) { if (e === BRK) break; if (e === CNT) continue; throw e; } } while (this.truthy(this.eval(node.c, sc))); return null; }
        case 'for': {
          const it = this.eval(node.it, sc);
          const s2 = new Scope(sc);
          const run = () => { try { this.exec(node.body, s2); } catch (e) { if (e === BRK) return 'b'; if (e === CNT) return; throw e; } };
          if (it instanceof Interval) { for (let i = it.a; i < it.b; i++) { s2.v.set(node.v, i); if (run() === 'b') break; } return null; }
          let list;
          if (node.v2) {
            list = it instanceof HxMap ? [...it.m.entries()] : Array.isArray(it) ? it.map((v, i) => [i, v]) : (it && typeof it === 'object') ? Object.entries(it) : [];
            for (const [k, v] of list) { s2.v.set(node.v, k); s2.v.set(node.v2, v); if (run() === 'b') break; }
            return null;
          }
          list = this.iterList(it);
          for (const v of list) { s2.v.set(node.v, v); if (run() === 'b') break; }
          return null;
        }
        case 'ret': throw new Ret(node.e ? this.eval(node.e, sc) : null);
        case 'break': throw BRK;
        case 'cont': throw CNT;
        case 'throw': throw new HxThrow(this.eval(node.e, sc));
        case 'try': {
          try { return this.exec(node.body, sc); }
          catch (e) {
            if (e instanceof Ret || e === BRK || e === CNT) throw e;
            const c = node.catches[0]; if (!c) return null;
            const s2 = new Scope(sc); s2.v.set(c.n, e instanceof HxThrow ? e.value : (e && e.message) || e);
            return this.exec(c.body, s2);
          }
        }
        default: return this.eval(node, sc);
      }
    }
    iterList(it) {
      if (it == null) return [];
      if (Array.isArray(it)) return it.slice();
      if (it instanceof HxMap) return [...it.m.values()];
      if (typeof it === 'string') return [...it];
      if (isStub(it)) return [];
      if (typeof it.iterator === 'function') { const r = it.iterator(); if (Array.isArray(r)) return r; it = r; }
      if (it && typeof it.hasNext === 'function') { const out = []; let g = 0; while (it.hasNext() && g++ < 1e5) out.push(it.next()); return out; }
      if (it && it.members && Array.isArray(it.members)) return it.members.slice();
      if (it && typeof it[Symbol.iterator] === 'function') return [...it];
      return [];
    }
    truthy(v) { return isStub(v) ? true : !!v; }
    /* ---- expresiones ---- */
    lookup(sc, n) {
      for (let s = sc; s; s = s.parent) if (s.v.has(n)) return { s };
      return null;
    }
    getId(n, sc) {
      const l = this.lookup(sc, n); if (l) return l.s.v.get(n);
      const self = sc.self;
      if (self) {
        if (Object.prototype.hasOwnProperty.call(self, n)) return self[n];
        if (self.__hxc) { const m = this.findMethod(self.__hxc, n); if (m) return m.cls.script.mkFunc(m.fn, null, self, m.cls); }
        else if (n in self) return self[n];
      }
      for (let c = sc.cls, d = 0; c && d < 12; c = c.script.parentOf(c), d++) {
        if (c.staticVals && n in c.staticVals) return c.staticVals[n];
        if (c.staticMethods[n]) return c.script.mkFunc(c.staticMethods[n], null, null, c);
      }
      const cls = this.findClass(n); if (cls) return cls;
      if (self && self.__hxc) { const nv = this.host.nativeMember(this.nativeBase(self.__hxc), self, n); if (nv !== undefined) return nv; }
      const g = this.host.global(n, this.alias.get(n));
      if (g !== undefined) return g;
      if (/^[A-Z]/.test(n)) { note(`clase desconocida: ${n}`); return stub(n); }
      note(`variable no definida: ${n} (se usa null)`);
      return null;
    }
    setId(n, v, sc) {
      const l = this.lookup(sc, n); if (l) { l.s.v.set(n, v); return v; }
      const self = sc.self;
      if (self && (Object.prototype.hasOwnProperty.call(self, n) || !self.__hxc)) { self[n] = v; return v; }
      for (let c = sc.cls, d = 0; c && d < 12; c = c.script.parentOf(c), d++) if (c.staticVals && n in c.staticVals) { c.staticVals[n] = v; return v; }
      if (self) { self[n] = v; return v; }
      sc.v.set(n, v); return v;
    }
    getField(o, n, opt) {
      if (o === null || o === undefined) { if (opt) return null; throw new Error(`acceso a ".${n}" de null`); }
      if (isStub(o)) return o[n];
      if (o.__hxcls) { const c = o; if (c.staticVals && n in c.staticVals) return c.staticVals[n]; if (c.staticMethods[n]) return c.script.mkFunc(c.staticMethods[n], null, null, c); note(`${c.name}.${n} no existe`); return null; }
      if (o.__hxc) {
        if (Object.prototype.hasOwnProperty.call(o, n)) return o[n];
        const m = this.findMethod(o.__hxc, n); if (m) return m.cls.script.mkFunc(m.fn, null, o, m.cls);
        const nv = this.host.nativeMember(this.nativeBase(o.__hxc), o, n); if (nv !== undefined) return nv;
        return null;
      }
      if (Array.isArray(o)) { if (n === 'length') return o.length; if (ARRAY_EXT[n]) return ARRAY_EXT[n](o); const f = o[n]; return typeof f === 'function' ? f.bind(o) : (f === undefined ? null : f); }
      if (typeof o === 'string') { if (n === 'length') return o.length; if (STR_EXT[n]) return STR_EXT[n](o); const f = o[n]; return typeof f === 'function' ? f.bind(o) : null; }
      if (typeof o !== 'object' && typeof o !== 'function') return null;
      const v = o[n];
      if (v === undefined) {
        if (o.__host) { note(`${o.__host}.${n} no está imitado`); return stub(`${o.__host}.${n}`); }
        return null;
      }
      if (typeof v === 'function' && !v.__hxfn && !v.__hxcls) return v.bind(o);
      return v;
    }
    setField(o, n, v) {
      if (o === null || o === undefined) throw new Error(`asignar ".${n}" en null`);
      if (isStub(o)) { o[n] = v; return v; }
      if (o.__hxcls) { o.staticVals[n] = v; return v; }
      if (o.__host && !(n in o) && !o.__open) note(`${o.__host}.${n} = … (guardado, sin efecto visual)`);
      o[n] = v; return v;
    }
    eq(a, b) {
      if (a === undefined) a = null; if (b === undefined) b = null;
      if (a === null || b === null) return a === b;
      if (typeof a === 'number' && typeof b === 'number')   // Int de Haxe (32 bits): 0xFF000000 == -16777216
        return a === b || (Number.isInteger(a) && Number.isInteger(b) && Math.abs(a) <= 0xFFFFFFFF && Math.abs(b) <= 0xFFFFFFFF && (a | 0) === (b | 0));
      return a === b;
    }
    binop(op, a, b) {
      switch (op) {
        case '+': return (typeof a === 'string' || typeof b === 'string') ? String(a ?? 'null') + String(b ?? 'null') : (a ?? 0) + (b ?? 0);
        case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
        case '==': return this.eq(a, b); case '!=': return !this.eq(a, b);
        case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        case '|': return a | b; case '&': return a & b; case '^': return a ^ b;
        case '<<': return a << b; case '>>': return a >> b; case '>>>': return a >>> b;
        case '...': return new Interval(a | 0, b | 0);
      }
      throw new Error('operador ' + op);
    }
    eval(node, sc) {
      switch (node.k) {
        case 'lit': if (node.isCheck) { const v = this.eval(node.isCheck, sc); return v !== null && v !== undefined; } return node.v;
        case 'str': return node.parts.map(p => typeof p === 'string' ? p : String(this.eval(p, sc) ?? 'null')).join('');
        case 'regex': return new EReg(node.src, node.flags);
        case 'id': return this.getId(node.n, sc);
        case 'this': return sc.self;
        case 'super': return { __super: true };
        case 'arr': return node.items.map(x => this.eval(x, sc));
        case 'map': return new HxMap(node.pairs.map(([k, v]) => [this.eval(k, sc), this.eval(v, sc)]));
        case 'obj': { const o = {}; for (const [k, v] of node.fields) o[k] = this.eval(v, sc); return o; }
        case 'fn': { const f = this.mkFunc(node, sc, sc.self, sc.cls); if (node.name) sc.v.set(node.name, f); return f; }
        case 'block': return this.exec(node, sc);
        case 'var': case 'ret': case 'while': case 'for': case 'do': case 'break': case 'cont': case 'throw': case 'try': case 'fndecl': return this.exec(node, sc);
        case 'field': { if (node.o.k === 'super') return this.superMember(sc, node.n); return this.getField(this.eval(node.o, sc), node.n, node.opt); }
        case 'index': {
          const o = this.eval(node.o, sc), i = this.eval(node.i, sc);
          if (o == null) { if (node.opt) return null; throw new Error('índice de null'); }
          if (o instanceof HxMap) return o.get(i);
          const v = o[i]; return v === undefined ? null : v;
        }
        case 'call': return this.call(node, sc);
        case 'new': {
          const args = node.args.map(a => this.eval(a, sc));
          const base = node.cls.split('.').pop();
          const cls = this.findClass(base);
          if (cls) return cls.script.instantiate(cls, args);
          return this.host.construct(base, args, node.cls);
        }
        case 'un': {
          if (node.op === '++' || node.op === '--') {
            const old = Number(this.eval(node.e, sc)) || 0, nv = node.op === '++' ? old + 1 : old - 1;
            this.assignTo(node.e, nv, sc); return node.post ? old : nv;
          }
          const v = this.eval(node.e, sc);
          return node.op === '!' ? !this.truthy(v) : node.op === '-' ? -v : ~v;
        }
        case 'bin': {
          if (node.op === '&&') return this.truthy(this.eval(node.a, sc)) && this.truthy(this.eval(node.b, sc));
          if (node.op === '||') return this.truthy(this.eval(node.a, sc)) || this.truthy(this.eval(node.b, sc));
          if (node.op === '??') { const a = this.eval(node.a, sc); return a === null || a === undefined ? this.eval(node.b, sc) : a; }
          return this.binop(node.op, this.eval(node.a, sc), this.eval(node.b, sc));
        }
        case 'assign': {
          if (node.op === '=') return this.assignTo(node.t, this.eval(node.v, sc), sc);
          if (node.op === '??=') { const cur = this.eval(node.t, sc); return cur == null ? this.assignTo(node.t, this.eval(node.v, sc), sc) : cur; }
          const cur = this.eval(node.t, sc);
          return this.assignTo(node.t, this.binop(node.op.slice(0, -1), cur, this.eval(node.v, sc)), sc);
        }
        case 'tern': return this.truthy(this.eval(node.c, sc)) ? this.eval(node.a, sc) : this.eval(node.b, sc);
        case 'if': { if (this.truthy(this.eval(node.c, sc))) return this.exec(node.a, sc); return node.b ? this.exec(node.b, sc) : null; }
        case 'switch': {
          const v = this.eval(node.e, sc);
          for (const c of node.cases) {
            let hit = false;
            for (const pv of c.vals) {
              if (pv.k === 'id' && pv.n === '_') { hit = true; break; }
              if (pv.k === 'id' && !this.lookup(sc, pv.n) && /^[a-z]/.test(pv.n) && !(sc.self && pv.n in sc.self)) { const s2 = new Scope(sc); s2.v.set(pv.n, v); if (!c.guard || this.truthy(this.eval(c.guard, s2))) return this.exec(c.body, s2); continue; }
              const x = this.eval(pv, sc);
              if (this.eq(x, v)) { hit = true; break; }
            }
            if (hit && (!c.guard || this.truthy(this.eval(c.guard, sc)))) return this.exec(c.body, sc);
          }
          return node.def ? this.exec(node.def, sc) : null;
        }
      }
      throw new Error('nodo ' + node.k);
    }
    assignTo(t, v, sc) {
      if (t.k === 'id') return this.setId(t.n, v, sc);
      if (t.k === 'field') { const o = this.eval(t.o, sc); if (o == null && t.opt) return null; return this.setField(o, t.n, v); }
      if (t.k === 'index') { const o = this.eval(t.o, sc), i = this.eval(t.i, sc); if (o instanceof HxMap) return o.set(i, v); if (o == null) throw new Error('índice de null'); o[i] = v; return v; }
      if (t.k === 'this') return v;
      throw new Error('asignación no válida');
    }
    superMember(sc, n) {
      const cls = sc.cls; const p = cls && cls.script.parentOf(cls);
      if (p) { const m = p.script.findMethod(p, n); if (m) return m.cls.script.mkFunc(m.fn, null, sc.self, m.cls); }
      return () => null;    // super.onX(event) de las clases del juego: sin efecto aquí
    }
    call(node, sc) {
      const args = () => node.args.map(a => this.eval(a, sc));
      const f = node.f;
      if (f.k === 'super') {   // super(...) en el constructor
        const cls = sc.cls, p = cls && cls.script.parentOf(cls), a = args();
        if (p) { const m = p.script.findMethod(p, 'new'); if (m) return m.cls.script.invoke(m.fn, null, sc.self, m.cls, a); return null; }
        this.host.nativeSuper((cls.parent || '').split('.').pop(), sc.self, a);
        return null;
      }
      let fn;
      if (f.k === 'field') {
        if (f.o.k === 'super') fn = this.superMember(sc, f.n);
        else { const o = this.eval(f.o, sc); if (o == null && f.opt) return null; fn = this.getField(o, f.n, f.opt); if (fn == null && f.opt) return null; }
      } else fn = this.eval(f, sc);
      if (fn == null) { if (node.opt) return null; throw new Error(`llamada a null (${this.describe(f)})`); }
      if (fn.__hxcls) { note(`${fn.name}() como función`); return null; }
      if (typeof fn !== 'function') throw new Error(`${this.describe(f)} no es una función`);
      const r = fn(...args());
      return r === undefined ? null : r;
    }
    describe(n) { return n.k === 'id' ? n.n : n.k === 'field' ? this.describe(n.o) + '.' + n.n : n.k === 'this' ? 'this' : n.k; }
  }

  /* ---------- análisis estático (recursos / llamadas) ---------- */
  const STD_PKG = /^(funkin|flixel|openfl|haxe|lime|polymod|sys|hxvlc|hxcodec|thx|StringTools|Std|Math|Reflect|Type|Lambda|Date|EReg|Xml|Json|Array|String|Map|Int|Float|Bool|Dynamic)\b/;
  function analyze(src) {
    const T = tokenize(src), res = [], modules = [], scripted = [], calls = new Set(), dynamic = [];
    const str = i => T[i] && T[i].t === 'str' && !T[i].interp ? T[i].v : null;
    const PATHS = { image: 'image', sound: 'sound', music: 'music', video: 'video', frag: 'frag', vert: 'frag', font: 'font', json: 'json', file: 'file', txt: 'file', getSparrowAtlas: 'sparrow', getPackerAtlas: 'sparrow', animateAtlas: 'atlas', xml: 'file' };
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (t.t !== 'id') continue;
      const callAt = (k) => T[k] && T[k].t === 'op' && T[k].v === '(';
      if (t.v === 'Paths' && T[i + 1]?.v === '.' && T[i + 2]?.t === 'id' && callAt(i + 3)) {
        const kind = PATHS[T[i + 2].v];
        if (kind) {
          const key = str(i + 4), lib = T[i + 5]?.v === ',' ? str(i + 6) : null;
          if (key !== null) res.push({ kind, key, lib }); else dynamic.push(`Paths.${T[i + 2].v}(…) con nombre dinámico`);
        }
      }
      if ((t.v === 'FunkinSprite' || t.v === 'FlxSprite') && T[i + 1]?.v === '.' && /^(create|createSparrow|createPacker|createTextureAtlas)$/.test(T[i + 2]?.v || '') && callAt(i + 3)) {
        // create(x, y, key)
        let j = i + 4, d = 0, argN = 0, start = j;
        for (; j < T.length; j++) { const v = T[j].v; if (T[j].t === 'op' && /[([{]/.test(v)) d++; else if (T[j].t === 'op' && /[)\]}]/.test(v)) { if (d === 0) break; d--; } else if (d === 0 && v === ',' && T[j].t === 'op') { argN++; start = j + 1; } if (argN === 2 && j === start) { const k = str(j); if (k !== null && T[j + 1]?.v !== '+') res.push({ kind: T[i + 2].v === 'createSparrow' ? 'sparrow' : T[i + 2].v === 'createTextureAtlas' ? 'atlas' : 'image', key: k }); } }
      }
      if (t.v === 'ModuleHandler' && T[i + 2]?.v === 'getModule') { const k = str(i + 4); if (k) modules.push(k); }
      if (/^Scripted\w+$/.test(t.v) && T[i + 1]?.v === '.' && /^(init|scriptInit)$/.test(T[i + 2]?.v || '')) { const k = str(i + 4); if (k) scripted.push({ base: t.v, name: k }); }
      // rutas de llamadas con raíz global (PlayState.instance.camGame.flash…)
      if (/^[A-Z]/.test(t.v) && (i === 0 || T[i - 1].v !== '.')) {
        let p = t.v, j = i + 1;
        while ((T[j]?.v === '.' || T[j]?.v === '?.') && T[j + 1]?.t === 'id') { p += '.' + T[j + 1].v; j += 2; }
        if (T[j]?.v === '(' && p.includes('.')) calls.add(p);
      }
      if (t.t === 'id' && t.v === 'import') { /* imports: se leen abajo */ }
    }
    for (let i = 0; i < T.length; i++) if (T[i].t === 'str' && /\.hxc$/i.test(T[i].v)) scripted.push({ base: 'hxc', name: T[i].v });
    const imports = [];
    for (let i = 0; i < T.length; i++) if (T[i].t === 'id' && T[i].v === 'import') { let p = ''; let j = i + 1; while (T[j] && !(T[j].t === 'op' && T[j].v === ';')) { p += T[j].v; j++; } imports.push(p); }
    const custom = imports.filter(p => !STD_PKG.test(p));
    return { res, modules: [...new Set(modules)], scripted, calls: [...calls], dynamic, imports, custom };
  }

  return { tokenize, Parser, Script, HxMap, EReg, Interval, stub, isStub, note, notes: R.notes, R, analyze, Scope };
})();
