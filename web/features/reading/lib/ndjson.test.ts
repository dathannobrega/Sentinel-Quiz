import { describe, expect, it } from "vitest";

import { createNdjsonParser, parseStreamLine, readStreamLines, StreamLineError } from "@/features/reading/lib/ndjson";

const encoder = new TextEncoder();

function bodyFrom(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    }
  });
}

describe("createNdjsonParser", () => {
  it("reassembles lines split across chunks and ignores blank lines", () => {
    const parser = createNdjsonParser();
    expect(parser.push(encoder.encode('{"type":"meta","te'))).toEqual([]);
    expect(parser.push(encoder.encode('xt":"a"}\n\n{"type":"do'))).toEqual(['{"type":"meta","text":"a"}']);
    expect(parser.push(encoder.encode('ne"}\n'))).toEqual(['{"type":"done"}']);
    expect(parser.flush()).toEqual([]);
  });

  it("accepts CRLF endings and a trailing line without newline", () => {
    const parser = createNdjsonParser();
    expect(parser.push(encoder.encode('{"a":1}\r\n{"b":2}\r\n{"c":3}'))).toEqual(['{"a":1}', '{"b":2}']);
    expect(parser.flush()).toEqual(['{"c":3}']);
  });

  it("does not break a multi-byte character split across chunks", () => {
    const bytes = encoder.encode('{"type":"meta","text":"ação"}\n');
    const parser = createNdjsonParser();
    expect(parser.push(bytes.slice(0, 20))).toEqual([]);
    const lines = parser.push(bytes.slice(20));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ type: "meta", text: "ação" });
  });
});

describe("parseStreamLine", () => {
  it("parses the four line types", () => {
    expect(parseStreamLine('{"type":"meta","text":"Hello.","sentences":1}')).toMatchObject({ type: "meta", text: "Hello." });
    expect(parseStreamLine('{"type":"segment","index":0,"audio_url":"/api/reading/audio/x","words":[]}')).toMatchObject({ type: "segment", index: 0 });
    expect(parseStreamLine('{"type":"done","duration_seconds":3.2}')).toEqual({
      type: "done",
      duration_seconds: 3.2
    });
    expect(parseStreamLine('{"type":"error","code":"tts_failed","message":"boom"}')).toEqual({ type: "error", code: "tts_failed", message: "boom" });
  });

  it("rejects malformed lines", () => {
    expect(() => parseStreamLine("not json")).toThrow(StreamLineError);
    expect(() => parseStreamLine('{"type":"other"}')).toThrow(StreamLineError);
    expect(() => parseStreamLine('{"type":"segment","index":"0"}')).toThrow(StreamLineError);
    expect(() => parseStreamLine('["x"]')).toThrow(StreamLineError);
  });
});

describe("readStreamLines", () => {
  it("yields lines in order from a chunked body, including an error line", async () => {
    const body = bodyFrom([
      '{"type":"meta","text":"One. Two.","sentences":2}\n{"type":"segm',
      'ent","index":0,"audio_url":"/a/0","words":[]}\r\n',
      '{"type":"segment","index":1,"audio_url":"/a/1","words":[]}\n{"type":"error","code":"tts_failed","message":"x"}'
    ]);
    const lines = [];
    for await (const line of readStreamLines(body)) {
      lines.push(line);
    }
    expect(lines.map((line) => line.type)).toEqual(["meta", "segment", "segment", "error"]);
  });

  it("stops with an AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode('{"type":"meta","text":"a"}\n'));
        // Never closes: the consumer must give up through the signal.
      }
    });
    const iterator = readStreamLines(body, controller.signal);
    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "meta" });
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
