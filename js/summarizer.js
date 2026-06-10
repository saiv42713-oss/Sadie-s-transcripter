// Live extractive summarization — fully local.
// TF-IDF sentence scoring over the growing transcript, plus topic-shift
// detection from transition phrases (silence gaps are detected in recorder.js).
(function () {
  const STOP_WORDS = new Set(('a,an,the,and,or,but,if,then,else,when,while,of,at,by,for,with,about,against,' +
    'between,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,' +
    'further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,' +
    'than,too,very,can,will,just,should,now,is,am,are,was,were,be,been,being,have,has,had,having,do,does,' +
    'did,doing,would,could,ought,im,youre,hes,shes,its,were,theyre,ive,youve,weve,theyve,id,youd,hed,shed,' +
    'wed,theyd,ill,youll,hell,shell,well,theyll,isnt,arent,wasnt,werent,hasnt,havent,hadnt,doesnt,dont,' +
    'didnt,wont,wouldnt,shant,shouldnt,cant,cannot,couldnt,mustnt,lets,thats,whos,whats,heres,theres,whens,' +
    'wheres,whys,hows,because,as,until,it,this,that,these,those,i,me,my,we,our,you,your,he,him,his,she,her,' +
    'they,them,their,what,which,who,whom,also,like,get,got,go,going,know,really,actually,basically,um,uh,' +
    'okay,ok,right,yeah,gonna,kind,sort,thing,things,lot,bit,one,two,say,said,see,want,make,way,much,mean')
    .split(','));

  const TRANSITION_PHRASES = [
    "now let's talk about", 'now let us talk about', "let's talk about", "now let's move",
    'moving on', 'move on to', 'the next thing', 'next topic', 'next up',
    'to summarize', 'to sum up', 'in conclusion', 'in summary', 'wrapping up',
    "let's switch", 'switching gears', 'turning to', "now we'll look at", 'another topic'
  ];

  function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/)
      .map((w) => w.replace(/'/g, ''))
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  }

  function splitSentences(text) {
    return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.split(' ').length >= 4);
  }

  // Score every sentence with TF-IDF; return the top N in transcript order.
  function extractKeyPoints(transcript, topN = 7) {
    const sentences = splitSentences(transcript);
    if (sentences.length === 0) return [];

    const sentTokens = sentences.map(tokenize);
    const docFreq = new Map();
    for (const tokens of sentTokens) {
      for (const t of new Set(tokens)) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
    const N = sentences.length;

    const scored = sentences.map((sentence, i) => {
      const tokens = sentTokens[i];
      if (tokens.length === 0) return { sentence, i, score: 0 };
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      let score = 0;
      for (const [t, f] of tf) {
        const idf = Math.log(1 + N / (docFreq.get(t) || 1));
        score += (f / tokens.length) * idf;
      }
      // Mild damping of very long sentences so rambles don't dominate.
      const len = tokens.length;
      const lengthFactor = len >= 6 && len <= 28 ? 1 : 0.78;
      return { sentence, i, score: score * lengthFactor };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .sort((a, b) => a.i - b.i)
      .map((s) => s.sentence);
  }

  // Returns the phrase if `text` opens a new topic, else null.
  function detectTransition(text) {
    const lower = text.toLowerCase();
    for (const phrase of TRANSITION_PHRASES) {
      if (lower.includes(phrase)) return phrase;
    }
    return null;
  }

  // Fallback summary when AI polish is skipped or unavailable.
  function extractiveSummaryMd(transcript, keyPoints, sections) {
    const lines = ['## Key Points', ''];
    for (const kp of keyPoints) lines.push(`- ${kp}`);
    if (sections && sections.length) {
      lines.push('', '## Sections', '');
      for (const s of sections) lines.push(`- ${s}`);
    }
    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    lines.push('', '---', '', `*Extractive summary generated locally · ${wordCount} words transcribed.*`);
    return lines.join('\n');
  }

  window.Summarizer = { extractKeyPoints, detectTransition, splitSentences, extractiveSummaryMd, tokenize };
})();
