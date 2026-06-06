// Extractive summarizer — pure browser JS, no dependencies

const STOP_WORDS = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are',
  'as','at','be','because','been','before','being','below','between','both','but',
  'by','can','did','do','does','doing','down','during','each','few','for','from',
  'further','get','got','had','has','have','having','he','her','here','him','his',
  'how','i','if','in','into','is','it','its','itself','just','like','me','more',
  'most','my','myself','no','nor','not','now','of','off','on','once','only','or',
  'other','our','out','over','own','same','she','should','so','some','such','than',
  'that','the','their','them','then','there','these','they','this','those','through',
  'to','too','under','until','up','us','was','we','were','what','when','where',
  'which','while','who','whom','why','will','with','would','you','your'
]);

const TOPIC_SHIFT_PATTERNS = [
  /now let'?s? talk about/i,
  /moving on/i,
  /the next topic/i,
  /turning to/i,
  /let me now/i,
  /next we(?:'ll)?/i,
  /another point/i,
  /on the other hand/i,
  /in contrast/i,
  /to summarize/i,
  /in conclusion/i,
  /finally,?/i,
  /first(?:ly)?,?/i,
  /second(?:ly)?,?/i,
  /third(?:ly)?,?/i
];

class ExtractiveSummarizer {
  constructor() {
    this.sentences = [];     // { text, timestamp }
    this.wordFreq = {};
    this.keyPoints = [];
    this.sections = [];      // { startIndex, label }
    this.currentSectionStart = 0;
  }

  addChunk(text, timestamp = Date.now()) {
    const newSentences = this._tokenize(text);
    if (newSentences.length === 0) return;

    // Check for topic shift
    const shiftMatch = TOPIC_SHIFT_PATTERNS.find(p => p.test(text));
    if (shiftMatch && this.sentences.length > 0) {
      this.sections.push({
        startIndex: this.currentSectionStart,
        endIndex: this.sentences.length,
        label: `Section ${this.sections.length + 1}`
      });
      this.currentSectionStart = this.sentences.length;
    }

    for (const s of newSentences) {
      const words = this._contentWords(s);
      for (const w of words) {
        this.wordFreq[w] = (this.wordFreq[w] || 0) + 1;
      }
      this.sentences.push({ text: s.trim(), timestamp });
    }

    this._updateKeyPoints();
    return this.keyPoints;
  }

  _tokenize(text) {
    // Split on sentence boundaries
    const raw = text.match(/[^.!?]+[.!?]+/g) || [];
    // Include any trailing fragment without punctuation
    const remainder = text.replace(/[^.!?]+[.!?]+/g, '').trim();
    if (remainder.length > 15) raw.push(remainder);
    return raw.filter(s => s.trim().length > 15);
  }

  _contentWords(sentence) {
    return sentence
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  _scoreSentence(sentence) {
    const words = this._contentWords(sentence);
    if (words.length === 0) return 0;

    const totalOccurrences = Object.values(this.wordFreq).reduce((a, b) => a + b, 0);
    if (totalOccurrences === 0) return 0;

    const score = words.reduce((sum, w) => sum + (this.wordFreq[w] || 0), 0) / words.length;
    // Normalize — prefer medium-length sentences
    const lengthBonus = Math.min(sentence.length / 120, 1);
    return score * (0.7 + 0.3 * lengthBonus);
  }

  _updateKeyPoints() {
    const scored = this.sentences
      .map((s, i) => ({ ...s, score: this._scoreSentence(s.text), index: i }))
      .filter(s => s.text.length > 20 && this._contentWords(s.text).length >= 3);

    // Pick top 7 unique sentences, preserve document order
    const top = [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, 7)
      .sort((a, b) => a.index - b.index);

    this.keyPoints = top.map(s => s.text);
  }

  getSections() {
    const all = [...this.sections];
    if (this.currentSectionStart < this.sentences.length) {
      all.push({
        startIndex: this.currentSectionStart,
        endIndex: this.sentences.length,
        label: `Section ${all.length + 1}`
      });
    }
    return all.map(sec => ({
      ...sec,
      sentences: this.sentences.slice(sec.startIndex, sec.endIndex).map(s => s.text)
    }));
  }

  getKeyPoints() {
    return this.keyPoints;
  }

  getMarkdownSummary() {
    if (this.keyPoints.length === 0) return '_No key points extracted yet._';
    return this.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
  }

  reset() {
    this.sentences = [];
    this.wordFreq = {};
    this.keyPoints = [];
    this.sections = [];
    this.currentSectionStart = 0;
  }
}

// Export for browser environment
window.ExtractiveSummarizer = ExtractiveSummarizer;
