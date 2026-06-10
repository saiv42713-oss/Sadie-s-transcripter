// Optional AI polish pass — streams a structured summary from the Anthropic API.
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const SYSTEM_PROMPT = `You are a meticulous lecture-notes editor. You will receive a verbatim
lecture transcript plus key sentences a local extractive algorithm pulled out.

Rules — follow all of them:
- Stay strictly grounded in the transcript. Never add outside knowledge, examples,
  or facts the speaker did not say. If something is unclear in the transcript, keep it unclear.
- Fill in important points the extractive pass missed.
- Rewrite choppy extracted sentences into coherent, readable prose.
- Preserve the lecturer's terminology and any definitions exactly as given.

Structure your output as Markdown with exactly these sections:

## TL;DR
(3 sentences maximum)

## Key Concepts
(bullet list of the central ideas, each one line)

## Notes
(organized prose notes; use the detected section breaks as subheadings when present)

## Action Items
(follow-ups, open questions, things the lecturer said to do — bullet list;
write "None mentioned." if the transcript contains none)`;

function client(apiKey) {
  return new Anthropic({ apiKey });
}

// Streams the polish pass. onDelta(text) is called per text chunk.
// Returns the full assembled markdown.
async function polish({ transcript, keyPoints, sections }, onDelta) {
  const { apiKey, anthropicModel } = config.load();
  if (!apiKey) throw new Error('NO_API_KEY');

  const sectionNote = sections && sections.length
    ? `\nDetected section breaks (in order): ${sections.join(' | ')}`
    : '';

  const stream = client(apiKey).messages.stream({
    model: anthropicModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content:
        `Here is the full lecture transcript:\n\n<transcript>\n${transcript}\n</transcript>\n\n` +
        `Key sentences selected by the local extractive pass:\n\n<key_points>\n${(keyPoints || []).join('\n')}\n</key_points>` +
        sectionNote +
        `\n\nProduce the structured summary now.`
    }]
  });

  stream.on('text', (delta) => onDelta && onDelta(delta));
  const final = await stream.finalMessage();
  return final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Validates a key with a trivial request. Returns { ok, message }.
async function testKey(apiKey) {
  try {
    await client(apiKey).messages.create({
      model: config.load().anthropicModel,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the word "ok".' }]
    });
    return { ok: true, message: 'Key works — AI polish is ready.' };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, message: "That key didn't work. Double-check it in Settings and try again." };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, message: "You're offline right now — we couldn't reach the API to test the key." };
    }
    return { ok: false, message: `The API said no: ${err.message || 'unknown error'}` };
  }
}

function isOfflineError(err) {
  return err instanceof Anthropic.APIConnectionError;
}

function isAuthError(err) {
  return err instanceof Anthropic.AuthenticationError;
}

module.exports = { polish, testKey, isOfflineError, isAuthError };
