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
 * True when the whole reply is a placeholder.
 *
 * A digit, a slash or a file extension means the text carries a fact, a path or
 * a number, so such a reply is kept whatever it starts with. "Noted on the
 * garage filter, and I added the $/sqft column." reads like an acknowledgement
 * and is not one.
 */
export declare function isPlaceholder(text: string): boolean;
//# sourceMappingURL=placeholder.d.ts.map