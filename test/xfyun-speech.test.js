import assert from "node:assert/strict";
import test from "node:test";

import { normalizeXfyunResult } from "../server/providers/xfyunSpeech.js";

const resultXml = `<?xml version="1.0" encoding="utf-8"?>
<xml_result>
  <read_sentence>
    <rec_paper>
      <read_sentence total_score="88" accuracy_score="86" fluency_score="75" integrity_score="67" except_info="0" is_rejected="false" content="can you help">
        <sentence>
          <word content="can" total_score="92" dp_message="0" beg_pos="10" end_pos="30">
            <syll content="can" syll_score="91"><phone content="k" beg_pos="10" end_pos="15"/><phone content="ae" beg_pos="15" end_pos="22"/><phone content="n" beg_pos="22" end_pos="30"/></syll>
          </word>
          <word content="you" total_score="0" dp_message="16" beg_pos="30" end_pos="30"/>
          <word content="please" total_score="40" dp_message="32" beg_pos="31" end_pos="40"/>
          <word content="help" total_score="35" dp_message="128" beg_pos="41" end_pos="60">
            <syll content="help" syll_score="34"><phone content="hh" beg_pos="41" end_pos="45"/><phone content="eh" beg_pos="45" end_pos="51"/><phone content="l" beg_pos="51" end_pos="55"/><phone content="p" beg_pos="55" end_pos="60"/></syll>
          </word>
        </sentence>
      </read_sentence>
    </rec_paper>
  </read_sentence>
</xml_result>`;

test("normalizes XFYUN sentence scores and word diagnostics", () => {
  const result = normalizeXfyunResult(resultXml);

  assert.equal(result.SuggestedScore, 88);
  assert.equal(result.PronAccuracy, 86);
  assert.equal(result.PronFluency, 0.75);
  assert.equal(result.PronCompletion, 0.67);
  assert.equal(result.ProviderRejected, false);
  assert.deepEqual(result.Words.map((word) => word.MatchTag), [0, 2, 1, 3]);
  assert.equal(result.Words[2].ReferenceWord, "*");
  assert.equal(result.Words[0].MemBeginTime, 100);
  assert.equal(result.Words[0].MemEndTime, 300);
  assert.equal(result.Words[0].PhoneInfos[1].ReferencePhone, "æ");
  assert.equal(result.RecognizedText, "can please help");
});

test("marks XFYUN exception results as provider-rejected", () => {
  const result = normalizeXfyunResult(`
    <xml_result><read_sentence><rec_paper>
      <read_sentence total_score="0" accuracy_score="0" fluency_score="0" integrity_score="0" except_info="28680" is_rejected="true" content="can you help">
        <sentence><word content="can" total_score="0" dp_message="16"/></sentence>
      </read_sentence>
    </rec_paper></read_sentence></xml_result>
  `);

  assert.equal(result.ProviderRejected, true);
  assert.equal(result.ProviderExceptionCode, 28680);
});

test("rejects XFYUN payloads without sentence assessment data", () => {
  assert.throws(() => normalizeXfyunResult("<xml_result><read_sentence/></xml_result>"), /did not include/);
});
