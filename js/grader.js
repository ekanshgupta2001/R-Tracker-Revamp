// ── R-Tracker v2 — Theory answer grader (rubric-based, deterministic) ────────
// Grades a written answer against the rubric attached to the lesson check in
// js/curriculum/lessons.js. No network, no model: normalize → fuzzy-match each
// required concept's accepted phrasings → score = concepts hit / concepts required
// → pass at the rubric threshold unless a disqualifying misconception is present.
//
// rubric-2 pipeline (in order):
//   1. too-short     fewer than minWords tokens (check.minWords, default 30) → score 0, fail
//   2. copied        ≥ 50% of the answer's 4-word shingles appear in question + lesson text
//                    + hints + labels + accepted phrases → fail, score ≤ 30 (35–50% → 'copy-note')
//   3. keyword-dump  function-word ratio < 0.18, or no sentence at all and ratio < 0.25, or ≥ 80%
//                    of the answer's words are rubric phrases (rubricDensity) → as copied
//   4. disqualifiers (unchanged: score ≤ 40, fail)
//   5. concepts      phrase matching; concepts marked negatable: true drop a phrase hit that has
//                    a negator ('not', 'never', 'without', …) one or two words before it
//   6. score = concepts hit / concepts, pass at the threshold
//   Every result carries flags[]: 'too-short' | 'copied' | 'copy-note' | 'keyword-dump' | 'negated:<id>'.
//
// Rubric shape (on check):
//   rubric: {
//     threshold: 0.7,                          // fraction of concepts needed to pass
//     concepts: [ { id, label, phrases: ['…', …], hint, negatable? } ],
//     disqualifiers: [ { phrases: ['…'], feedback } ]   // optional; a hit fails the answer
//   }
//   graded: false  → reflection: stored for a mentor, never scored
//
// Return shape (same as the Phase 1 stub):
//   { status: 'graded' | 'reflection' | 'ungraded', grader, graderVersion, passed, score,
//     feedback, strengths[], misconceptions[], suggestion, hits[], missed[], flags[] }
//   or { error: true, message } for rejected input.
//
// Exposes: window.gradeTheoryAnswer(phaseId, sectionId, question, answer), window.RTGrader

(function () {
  'use strict';

  var VERSION = 'rubric-2';
  var MAX_THEORY_LENGTH = 5000;

  // ── Text normalization ────────────────────────────────────────────────────
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/×/g, 'x')
      .replace(/[^a-z0-9%.\/\-\s']/g, ' ')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')     // 1,000 → 1000 (but "24, 24" stays two numbers)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(s) {
    return normalize(s).split(' ').filter(Boolean).map(function (t) { return t.replace(/^[.'-]+|[.'-]+$/g, ''); }).filter(Boolean);
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  // Word-level fuzzy equality: exact, or 1 edit for words ≥ 5 chars, 2 edits for words ≥ 9 chars.
  function wordMatch(a, b) {
    if (a === b) return true;
    var len = Math.min(a.length, b.length);
    if (len < 5) return false;
    var d = levenshtein(a, b);
    return d <= (len >= 9 ? 2 : 1);
  }

  // Does the phrase occur in the answer? Exact normalized substring first, then a fuzzy
  // word-sequence match (each phrase word must fuzzy-match consecutive answer words).
  function phraseMatches(phrase, normAnswer, answerTokens) {
    var np = normalize(phrase);
    if (!np) return false;
    var pw = tokens(np);
    if (!pw.length) return false;
    // Short single words must match a whole token ("up" must not match "update").
    if (pw.length === 1 && pw[0].length < 5) return answerTokens.indexOf(pw[0]) !== -1;
    if (normAnswer.indexOf(np) !== -1) return true;
    for (var i = 0; i + pw.length <= answerTokens.length; i++) {
      var ok = true;
      for (var j = 0; j < pw.length; j++) {
        if (!wordMatch(pw[j], answerTokens[i + j])) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  // ── Text statistics (copy / keyword-dump detection) ───────────────────────
  var NEGATORS = ['not', 'no', 'never', 'without', "doesn't", "isn't", 'cannot', "can't", "won't", 'nothing', 'neither'];

  // English function words. A real explanation is roughly 30–50% function words; a list of
  // pasted key phrases is well under 20%.
  var STOPWORDS = [
    'a', 'an', 'the',
    'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'as', 'into', 'onto', 'over', 'under', 'about',
    'between', 'through', 'after', 'before', 'during', 'against', 'up', 'down', 'out', 'off', 'past',
    'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its',
    'they', 'them', 'their', 'this', 'that', 'these', 'those', "it's", "that's",
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'done', 'has', 'have', 'had',
    'can', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'shall',
    'and', 'or', 'but', 'nor', 'so', 'because', 'if', 'while', 'until', 'when', 'then', 'than', 'though',
    'like', 'also', 'only', 'just', 'very', 'more', 'most', 'each', 'every', 'all', 'some', 'any',
    'there', 'here', 'what', 'which', 'who', 'how', 'why', 'where', 'not', 'no'
  ];
  // rubricDensity() at or above this is a pasted phrase list (correct fixtures: max 0.52; a
  // dump of the rubric's own phrases: 1.00).
  var DENSITY_DUMP = 0.80;
  var STOP_SET = {};
  STOPWORDS.forEach(function (w) { STOP_SET[w] = true; });
  var NEG_SET = {};
  NEGATORS.forEach(function (w) { NEG_SET[w] = true; });

  function stripHtml(html) {
    return String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function shingleSet(toks, n) {
    var set = {};
    for (var i = 0; i + n <= toks.length; i++) set[toks.slice(i, i + n).join(' ')] = true;
    return set;
  }

  // Fraction of the subject's distinct n-word shingles that also occur in the reference.
  // Both arguments are token arrays (or strings, which are tokenized first).
  function coverage(subjectTokens, refTokens, n) {
    n = n || 4;
    var subj = typeof subjectTokens === 'string' ? tokens(subjectTokens) : (subjectTokens || []);
    var ref = typeof refTokens === 'string' ? tokens(refTokens) : (refTokens || []);
    var s = shingleSet(subj, n), r = shingleSet(ref, n);
    var total = 0, hit = 0;
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
      total++;
      if (Object.prototype.hasOwnProperty.call(r, k)) hit++;
    }
    return total ? hit / total : 0;
  }

  function stopwordRatio(text) {
    var t = tokens(text);
    if (!t.length) return 0;
    var n = 0;
    for (var i = 0; i < t.length; i++) if (STOP_SET[t[i]]) n++;
    return n / t.length;
  }

  // Sentence-ish breaks: . ! ? ; : followed by whitespace or the end, plus line breaks that
  // separate two non-empty lines.
  function sentenceCount(text) {
    var s = String(text || '');
    var m = s.match(/[.!?;:](?=\s|$)/g);
    var n = m ? m.length : 0;
    var lines = s.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length > 1) n += lines.length - 1;
    return n;
  }

  // ── Phrase spans (for opt-in negation) ────────────────────────────────────
  // Token positions [start, end) in normAnswer.split(' ') where the phrase occurs, by exact
  // substring (mapped to the token it starts in) or by fuzzy word sequence.
  function phraseSpans(phrase, normAnswer, rawToks) {
    var np = normalize(phrase);
    if (!np) return [];
    var pw = tokens(np);
    if (!pw.length) return [];
    var len = np.split(' ').length;
    var starts = {};
    if (pw.length === 1 && pw[0].length < 5) {
      for (var a = 0; a < rawToks.length; a++) if (rawToks[a] === pw[0]) starts[a] = true;
    } else {
      var from = 0, idx;
      while ((idx = normAnswer.indexOf(np, from)) !== -1) {
        var before = normAnswer.slice(0, idx);
        starts[before ? before.split(' ').length - 1 : 0] = true;
        from = idx + 1;
      }
      for (var i = 0; i + pw.length <= rawToks.length; i++) {
        var ok = true;
        for (var j = 0; j < pw.length; j++) {
          if (!rawToks[i + j] || !wordMatch(pw[j], rawToks[i + j])) { ok = false; break; }
        }
        if (ok) starts[i] = true;
      }
    }
    var out = [];
    for (var k in starts) if (Object.prototype.hasOwnProperty.call(starts, k)) out.push([+k, +k + len]);
    return out;
  }

  // Fraction of the answer's tokens covered by the union of the spans of every rubric phrase
  // (concepts and disqualifiers) that occurs in it. Real explanations sit well under half;
  // the rubric's phrase lists pasted back sit near 1.
  function rubricDensity(answer, rubric) {
    var normAnswer = normalize(answer);
    var answerTokens = tokens(answer);
    var rawToks = normAnswer.split(' ').map(function (t) { return t.replace(/^[.'-]+|[.'-]+$/g, ''); });
    var real = 0, i;
    for (i = 0; i < rawToks.length; i++) if (rawToks[i]) real++;
    if (!real) return 0;
    var covered = {};
    var lists = [];
    ((rubric && rubric.concepts) || []).forEach(function (c) { lists.push(c.phrases || []); });
    ((rubric && rubric.disqualifiers) || []).forEach(function (d) { lists.push(d.phrases || []); });
    lists.forEach(function (phrases) {
      phrases.forEach(function (p) {
        if (!phraseMatches(p, normAnswer, answerTokens)) return;
        phraseSpans(p, normAnswer, rawToks).forEach(function (sp) {
          for (var k = sp[0]; k < sp[1] && k < rawToks.length; k++) if (rawToks[k]) covered[k] = true;
        });
      });
    });
    var n = 0;
    for (var key in covered) if (Object.prototype.hasOwnProperty.call(covered, key)) n++;
    return n / real;
  }

  function phraseHasNegator(phrase) {
    return tokens(phrase).some(function (w) { return NEG_SET[w]; });
  }

  // ── Rubric lookup ─────────────────────────────────────────────────────────
  function findSection(phaseId, sectionId) {
    var lessons = window.PHASE_LESSONS && window.PHASE_LESSONS[phaseId];
    if (!lessons) return null;
    for (var i = 0; i < lessons.length; i++) if (lessons[i].id === sectionId) return lessons[i];
    return null;
  }

  // ── Grading ───────────────────────────────────────────────────────────────
  function gradeWithRubric(answer, rubric, meta) {
    meta = meta || {};
    answer = typeof answer === 'string' ? answer : '';
    var normAnswer = normalize(answer);
    var answerTokens = tokens(answer);
    var concepts = rubric.concepts || [];
    var labelOf = function (c) { return c.label || c.id; };
    var flags = [];

    // 1. Too short
    var minWords = meta.minWords || rubric.minWords || 30;
    if (answerTokens.length < minWords) {
      return {
        status: 'graded', grader: 'rubric', graderVersion: VERSION, passed: false, score: 0,
        feedback: 'Write at least ' + minWords + ' words — explain it in full sentences.',
        strengths: [], misconceptions: [], suggestion: '',
        hits: [], missed: concepts.map(function (c) { return c.id; }), flags: ['too-short']
      };
    }

    // 2. Copied from the question, the lesson, the hints or the labels
    var refParts = [meta.question || '', stripHtml(meta.learn || '')];
    concepts.forEach(function (c) { refParts.push(c.hint || '', c.label || '', (c.phrases || []).join(' ')); });
    (rubric.disqualifiers || []).forEach(function (d) { refParts.push((d.phrases || []).join(' ')); });
    var c4 = coverage(answerTokens, tokens(refParts.join(' ')), 4);
    var copied = c4 >= 0.50;
    if (copied) flags.push('copied');
    else if (c4 >= 0.35) flags.push('copy-note');

    // 3. Keyword dump
    var ratio0 = stopwordRatio(answer);
    var dump = ratio0 < 0.18 || (sentenceCount(answer) === 0 && ratio0 < 0.25) ||
      rubricDensity(answer, rubric) >= DENSITY_DUMP;
    if (dump) flags.push('keyword-dump');

    // 4. Disqualifiers
    var misconceptions = [];
    (rubric.disqualifiers || []).forEach(function (d) {
      if ((d.phrases || []).some(function (p) { return phraseMatches(p, normAnswer, answerTokens); })) misconceptions.push(d.feedback || 'This contains a common misconception.');
    });

    // 5. Concepts (with opt-in negation)
    var rawToks = normAnswer.split(' ').map(function (t) { return t.replace(/^[.'-]+|[.'-]+$/g, ''); });
    var matchedByConcept = concepts.map(function (c) {
      return (c.phrases || []).filter(function (p) { return phraseMatches(p, normAnswer, answerTokens); });
    });
    var anyNegatable = concepts.some(function (c) { return c.negatable; });
    var allSpans = [];
    if (anyNegatable) {
      matchedByConcept.forEach(function (phrases) {
        phrases.forEach(function (p) { allSpans = allSpans.concat(phraseSpans(p, normAnswer, rawToks)); });
      });
    }
    function insideOtherSpan(pos, own) {
      for (var i = 0; i < allSpans.length; i++) {
        var sp = allSpans[i];
        if (sp[0] === own[0] && sp[1] === own[1]) continue;
        if (pos >= sp[0] && pos < sp[1]) return true;
      }
      return false;
    }
    function spanNegated(span) {
      for (var d = 1; d <= 2; d++) {
        var pos = span[0] - d;
        if (pos < 0) break;
        if (NEG_SET[rawToks[pos]] && !insideOtherSpan(pos, span)) return true;
      }
      return false;
    }

    var hits = [], missed = [], negatedConcepts = [];
    concepts.forEach(function (c, ci) {
      var phrases = matchedByConcept[ci];
      var matched = phrases.length > 0;
      if (matched && c.negatable) {
        var live = phrases.some(function (p) {
          if (phraseHasNegator(p)) return true;
          var spans = phraseSpans(p, normAnswer, rawToks);
          if (!spans.length) return true;                  // matched but not locatable: keep the hit
          return spans.some(function (sp) { return !spanNegated(sp); });
        });
        if (!live) { matched = false; negatedConcepts.push(c); flags.push('negated:' + c.id); }
      }
      (matched ? hits : missed).push(c);
    });

    // 6. Score and threshold
    var total = concepts.length || 1;
    var ratio = hits.length / total;
    var score = Math.round(ratio * 100);
    var threshold = typeof rubric.threshold === 'number' ? rubric.threshold : 0.7;
    var disqualified = misconceptions.length > 0;
    if (disqualified) score = Math.min(score, 40);
    if (copied || dump) score = Math.min(score, 30);
    var passed = !disqualified && !copied && !dump && ratio >= threshold - 1e-9;

    var feedback;
    if (copied) {
      feedback = 'This reads like the lesson, the question or the hints pasted back — explain it in your own words.';
    } else if (dump) {
      feedback = 'This looks like a list of keywords — write full sentences.';
    } else if (passed) {
      feedback = 'Good — you covered ' + hits.length + ' of ' + total + ' key ideas: ' + hits.map(labelOf).join(', ') + '.';
      if (missed.length) feedback += ' You could also mention: ' + missed.map(labelOf).join(', ') + '.';
    } else if (disqualified) {
      feedback = 'Not quite. ' + misconceptions[0] + (hits.length ? ' You did cover: ' + hits.map(labelOf).join(', ') + '.' : '');
    } else {
      feedback = (hits.length ? 'You covered: ' + hits.map(labelOf).join(', ') + '. ' : 'None of the key ideas came through yet. ') +
        'Still missing: ' + missed.map(function (c) { return labelOf(c) + (c.hint ? ' — ' + c.hint : ''); }).join('; ') + '.';
    }
    negatedConcepts.forEach(function (c) { feedback += ' You wrote the opposite of ‘' + labelOf(c) + '’ — re-read the lesson.'; });
    if (!copied && flags.indexOf('copy-note') !== -1) feedback += ' Some of this is copied — say it in your own words.';

    return {
      status: 'graded',
      grader: 'rubric',
      graderVersion: VERSION,
      passed: passed,
      score: score,
      feedback: feedback,
      strengths: hits.map(labelOf),
      misconceptions: misconceptions,
      suggestion: missed.length && missed[0].hint && !copied && !dump ? missed[0].hint : '',
      hits: hits.map(function (c) { return c.id; }),
      missed: missed.map(function (c) { return c.id; }),
      flags: flags
    };
  }

  function grade(phaseId, sectionId, question, answer) {
    if (typeof answer !== 'string') answer = '';
    if (answer.length > MAX_THEORY_LENGTH) {
      return { error: true, message: 'Answer is too long. Please keep it under ' + MAX_THEORY_LENGTH.toLocaleString() + ' characters.' };
    }
    var sec = findSection(phaseId, sectionId);
    var check = sec && sec.check;
    if (check && check.graded === false) {
      return {
        status: 'reflection', grader: null, graderVersion: null, passed: null, score: null,
        feedback: 'This is a reflection question — there is no single right answer. Your answer is kept in your progress file for your mentor to read.',
        strengths: [], misconceptions: [], suggestion: '', hits: [], missed: [], flags: []
      };
    }
    if (!check || !check.rubric) {
      return {
        status: 'ungraded', grader: null, graderVersion: null, passed: null, score: null,
        feedback: 'This question has no rubric yet. Your answer is saved in your progress file so a mentor can read it.',
        strengths: [], misconceptions: [], suggestion: '', hits: [], missed: [], flags: []
      };
    }
    var meta = { question: question || check.question || '', learn: sec.learn || '', minWords: check.minWords };
    // Copy detection always compares against the lesson's own question text as well.
    if (question && check.question && question !== check.question) meta.question = question + ' ' + check.question;
    return gradeWithRubric(answer, check.rubric, meta);
  }

  window.gradeTheoryAnswer = grade;
  window.RTGrader = {
    VERSION: VERSION, normalize: normalize, tokens: tokens, levenshtein: levenshtein, wordMatch: wordMatch, phraseMatches: phraseMatches,
    gradeWithRubric: gradeWithRubric, grade: grade,
    coverage: coverage, stopwordRatio: stopwordRatio, sentenceCount: sentenceCount, stripHtml: stripHtml,
    phraseSpans: phraseSpans, rubricDensity: rubricDensity, DENSITY_DUMP: DENSITY_DUMP,
    NEGATORS: NEGATORS, STOPWORDS: STOPWORDS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = window.RTGrader;
})();
