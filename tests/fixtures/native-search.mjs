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
