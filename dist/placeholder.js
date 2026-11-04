/**
 * Replies that carry no information and no action must not become a phone
 * notification.
 *
 * The bridge stays quiet when a turn's text is empty, so it has no way to catch
 * a model that writes a placeholder instead of staying silent. On 2026-10-25 a
 * turn whose only incoming item was a subagent progress note answered with
 * "No response requested.", and the user read it as a reply to a question nobody
 * asked. An earlier run on 2026-10-24 delivered a string of loop narration
 * ("end", "done", "I am stopping now") after a restart.
 *
 * The fix belongs here rather than in a `message_end` extension. Pi joins an
 * assistant message's text blocks into one string when it replays history to the
 * provider, so blanking the text to hide it would persist an empty assistant
 * message and risk a 400 on the next request. Dropping it at the send gate keeps
 * the session log intact and the phone quiet.
 */
/**
 * Each pattern matches the whole trimmed reply, so a real answer that merely
 * starts with one of these words survives.
 *
 * Three families. Bare acknowledgements ("Understood", "Noted", "Got it"). An
 * acknowledgement plus a promise that names no work ("On it", "Will do"). And
 * narration about the agent loop in place of a reply ("I am stopping now",
 * "end", "final").
 *
 * `Done`, `Finished` and `Yes` are deliberately absent. They are short, but they
 * answer something: the first two report a completed action, and `Yes` answers a
 * yes/no question.
 */
const PLACEHOLDER_RES = [
    // The placeholder and its harness variants.
    /^no\s+(response|reply|answer)\s+(requested|needed|required)[\s.!]*$/iu,
    /^(nothing\s+to\s+(add|report|say)|no\s+update|no\s+action\s+needed?)[\s.!]*$/iu,
    // Bare acknowledgements.
    /^(understood|noted|noted\s+with\s+interest|duly\s+noted|got\s+it|ack(?:nowledged)?|roger\s+that|aye\s+aye)[\s.!]*$/iu,
    /^(ok(?:ay)?|k\.?|sure|thanks|thank\s+you|thx|ty|cheers)[\s.!]*$/iu,
    // Acknowledgement plus a promise that names no work.
    /^(i(?:'| a)?m?\s*)?(on\s+it|working\s+on\s+it|will\s+do|will\s+do\s+that|consider\s+it\s+done|coming\s+right\s+up|right\s+on|you\s+got\s+it|sure\s+thing)[\s.!]*$/iu,
    // Narration about the agent loop instead of an answer.
    /^(i(?:'| a)?m?\s+)?(stopping|ending\s+my\s+turn|done\s+for\s+now)(\s+now)?[\s.!]*$/iu,
    /^i\s+will\s+(not\s+make\s+any\s+more|no\s+more)\s+tool\s+calls[\s.!]*$/iu,
    /^(end|final|finish|stop|waiting|echo)[\s.!]*$/iu,
];
/**
 * True when the whole reply is a placeholder.
 *
 * A digit, a slash or a file extension means the text carries a fact, a path or
 * a number, so such a reply is kept whatever it starts with. "Noted on the
 * garage filter, and I added the $/sqft column." reads like an acknowledgement
 * and is not one.
 */
export function isPlaceholder(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return true;
    if (/[0-9/]|https?:\S|\.(ts|py|sh|md|json|html)\b/iu.test(trimmed))
        return false;
    return PLACEHOLDER_RES.some((re) => re.test(trimmed));
}
//# sourceMappingURL=placeholder.js.map