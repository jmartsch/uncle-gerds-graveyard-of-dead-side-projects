// Uncle Gerd speaks English only. Older texts (and the odd LLM slip) still contain his German phrases,
// so every exhibit text is cleaned when it is loaded.
const RULES = [
  [/\bAch,?\s+Junge\b/g, 'Oh, kid'],
  [/\bHab ich doch gesagt\b/gi, 'Told you so'],
  [/\bNa also\b/gi, 'There you go'],
  [/\bNa eben\b/gi, 'Exactly'],
  [/\bNa ja\b/gi, 'Well'],
  [/\bJunge\b/gi, 'kid'],
  [/\bAch\b/g, 'Oh'],
  [/,\s*ja\?/g, ', right?'],
];

export function englishOnly(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [pattern, english] of RULES) out = out.replace(pattern, english);
  // Lowercase words that ended up at the start of a sentence get a capital letter.
  return out.replace(/(^|[.!?]\s+|[—–-]\s+)(kid|well|exactly)\b/g, (m, lead, word) => lead + word[0].toUpperCase() + word.slice(1));
}

export function englishExhibit(ex) {
  if (!ex || typeof ex !== 'object') return ex;
  return {
    ...ex,
    title: englishOnly(ex.title),
    plaque: englishOnly(ex.plaque),
    causeOfDeath: englishOnly(ex.causeOfDeath),
    uncle: ex.uncle && { ...ex.uncle, line: englishOnly(ex.uncle.line), quip: englishOnly(ex.uncle.quip) },
    quest: ex.quest && { ...ex.quest, why: englishOnly(ex.quest.why) },
  };
}
