// Synthetic wire fixtures grounded in the official Gateway/provider contracts.
// See docs/operations/chatkhu-phase1-implementation-2026-10-08.md for source URLs.
export const source = { url: "https://example.test/public-statistic", title: "Synthetic public statistic" };
export const claudeEvents = [
  { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"synthetic ' } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'public statistic"}' } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srv_1",
    content: [{ type: "web_search_result", ...source, encrypted_content: "synthetic-opaque-provider-data" }] } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "합성 통계 답변" } },
  { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: {
    type: "web_search_result_location", ...source, cited_text: "synthetic evidence", encrypted_index: "synthetic-index" } } },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7, server_tool_use: { web_search_requests: 1 } } },
  { type: "message_stop" }
];
export const openaiAnnotation = { type: "url_citation", ...source, start_index: 0, end_index: 5 };
export const openaiEvents = [
  { type: "response.created", response: { id: "resp_synthetic" } },
  { type: "response.web_search_call.in_progress", item_id: "ws_1", output_index: 0 },
  { type: "response.web_search_call.completed", item_id: "ws_1", output_index: 0 },
  { type: "response.output_item.done", item: { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", queries: ["synthetic public statistic"] } } },
  { type: "response.output_text.delta", delta: "합성 통계 답변" },
  { type: "response.output_text.annotation.added", annotation: openaiAnnotation, output_index: 1, content_index: 0, annotation_index: 0 },
  { type: "response.completed", response: { id: "resp_synthetic", status: "completed", usage: { input_tokens: 10, output_tokens: 7 },
    output: [{ id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "synthetic public statistic" } },
      { type: "message", content: [{ type: "output_text", text: "합성 통계 답변", annotations: [openaiAnnotation] }] }] } }
];
export const geminiEvents = [
  { candidates: [{ index: 0, content: { role: "model", parts: [{ thought: true, text: "synthetic hidden reasoning", thoughtSignature: "synthetic" }] } }] },
  { candidates: [{ index: 0, content: { role: "model", parts: [{ text: "합성 통계 답변" }] } }] },
  { candidates: [{ index: 0, groundingMetadata: { webSearchQueries: ["synthetic public statistic"],
    groundingChunks: [{ web: { uri: source.url, title: source.title } }],
    groundingSupports: [{ segment: { partIndex: 0, startIndex: 0, endIndex: 6, text: "합성" }, groundingChunkIndices: [0, -1, 999] }],
    searchEntryPoint: { renderedContent: '<script>untrusted HTML</script>' } }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 7, thoughtsTokenCount: 3, totalTokenCount: 20 } }
];

export const geminiMultiQueryEvents = geminiEvents.map((event) => {
  if (!event.candidates?.[0]?.groundingMetadata) return event;
  return { ...event, candidates: [{ ...event.candidates[0], groundingMetadata: {
    ...event.candidates[0].groundingMetadata,
    webSearchQueries: ["synthetic public statistic", "synthetic hospital policy", "synthetic study", "", "synthetic study"]
  } }] };
});

export const claudePauseEvents = claudeEvents.map((event) => event.type === "message_delta"
  ? { ...event, delta: { stop_reason: "pause_turn" } } : event);

// --- Review-fix fixtures (synthetic; shapes follow the Anthropic web_search / OpenAI Responses documents). ---
const claudeSearchOk = claudeEvents.slice(1, 7); // server_tool_use srv_1 + its successful web_search_tool_result
const claudeSearchFailed = [
  { type: "content_block_start", index: 3, content_block: { type: "server_tool_use", id: "srv_2", name: "web_search", input: { query: "synthetic second query" } } },
  { type: "content_block_stop", index: 3 },
  { type: "content_block_start", index: 4, content_block: { type: "web_search_tool_result", tool_use_id: "srv_2",
    content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } } },
  { type: "content_block_stop", index: 4 }
];
const claudeAnswer = [
  { type: "content_block_start", index: 5, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 5, delta: { type: "text_delta", text: "Complete answer." } },
  { type: "content_block_stop", index: 5 }
];
// Failed searches are not billed, so usage counts only the searches that completed.
const claudeEnd = (requests) => [
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7, ...(requests ? { server_tool_use: { web_search_requests: requests } } : {}) } },
  { type: "message_stop" }
];
/** One search completed with a source, a second search failed, the answer finished normally. */
export const claudePartialFailureEvents = [claudeEvents[0], ...claudeSearchOk, ...claudeSearchFailed, ...claudeAnswer, ...claudeEnd(1)];
/** Every search failed but the model still answered and stopped normally. */
export const claudeAllFailedEvents = [claudeEvents[0], ...claudeSearchFailed, ...claudeAnswer, ...claudeEnd(0)];
/** A search completed, then the stream broke before the answer finished. */
export const claudeExecutedThenStallEvents = [claudeEvents[0], ...claudeSearchOk];
/** Non-streaming Messages response (stream:false, e.g. with serverCode); same blocks as the stream above. */
export const claudeJsonMessage = {
  id: "msg_synthetic", type: "message", role: "assistant", stop_reason: "end_turn",
  content: [
    { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "synthetic public statistic" } },
    { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", ...source, encrypted_content: "synthetic-opaque-provider-data" }] },
    { type: "text", text: "합성 통계 답변", citations: [{ type: "web_search_result_location", ...source, cited_text: "synthetic evidence", encrypted_index: "synthetic-index" }] }
  ],
  usage: { input_tokens: 10, output_tokens: 7, server_tool_use: { web_search_requests: 1 } }
};
/** Non-streaming Responses object. */
export const responsesJsonResponse = {
  id: "resp_synthetic", object: "response", status: "completed", usage: { input_tokens: 10, output_tokens: 7 },
  output: [{ id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "synthetic public statistic" } },
    { type: "message", content: [{ type: "output_text", text: "합성 통계 답변", annotations: [openaiAnnotation] }] }]
};
/** Sonar bridge completion with `count` distinct sources. */
export const sonarJsonResponse = (count) => ({
  choices: [{ message: { content: "synthetic evidence summary" } }],
  citations: Array.from({ length: count }, (_, i) => `https://example.test/sonar/${i}`)
});
