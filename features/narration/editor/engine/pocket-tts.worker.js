/*
 * Derived from `inference-worker.js` in the Pocket TTS ONNX web demo,
 * licensed Apache-2.0. Modified for Post Voice: model files are fetched from a
 * pinned Hugging Face mirror via MODEL_BASE_URL instead of a relative ./onnx/
 * path, the tokenizer import no longer carries a ?v=3 query string, and the
 * ONNX Runtime CDN import is marked webpackIgnore so the bundler leaves it as a
 * runtime URL, and model files are routed through a Cache API interceptor
 * installed by `installModelCache()` below, because Hugging Face serves them
 * with no Cache-Control at all. See CREDITS.md for full attribution.
 *
 * Also modified: the mimi decoder's state now carries forward across a
 * segment's internal chunks (flow-LM state still resets per chunk — carrying
 * it forward was tried and reverted, see below), the gap between chunks is
 * shorter, an oversized sentence is split at a punctuation pause instead of a
 * raw token boundary, and text is run through sanitizeForTokenizer() before
 * every encodeIds() call — the tokenizer has no vocabulary piece for curly
 * quotes/guillemets/ellipsis, and falls back to raw bytes that decode to
 * U+FFFD. See
 * docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md
 * and
 * docs/superpowers/specs/2026-08-18-narration-punctuation-sanitization-design.md
 * for why — the demo's defaults were tuned for short standalone phrases, not
 * whole posts.
 */
// Pocket TTS ONNX Web Worker
import { MODEL_BASE_URL } from '../model-source';
import { installModelCache } from './model-cache';
import { sanitizeForTokenizer } from './tokenizer-sanitize';

// Must run before any model file is requested: Hugging Face sends no
// Cache-Control, so without this the ~190MB bundle is re-fetched every session.
installModelCache();

console.log("Pocket TTS Worker Starting...");
self.postMessage({ type: "status", status: "Worker Thread Started", state: "idle" });

let ort = null;

const DEFAULT_LANGUAGE = "english_2026-04";
const LANGUAGE_BUNDLES = ["english_2026-04", "german", "italian", "portuguese", "spanish"];
const MODEL_STEMS = {
    mimi_encoder: "mimi_encoder_int8.onnx",
    text_conditioner: "text_conditioner_int8.onnx",
    flow_lm_main: "flow_lm_main_int8.onnx",
    flow_lm_flow: "flow_lm_flow_int8.onnx",
    mimi_decoder: "mimi_decoder_int8.onnx",
};
const DEBUG_LOGS = false;
const CHUNK_GAP_SEC = 0.06;
const MAX_FRAMES = 500;
const LSD_STEPS = 1;

let currentLanguage = DEFAULT_LANGUAGE;
let currentBundleDir = null;
let bundleMetadata = null;
let tokenizerProcessor = null;
let tokenizerModelB64 = null;
let bosBeforeVoice = null;

let mimiEncoderSession = null;
let textConditionerSession = null;
let flowLmMainSession = null;
let flowLmFlowSession = null;
let mimiDecoderSession = null;

let currentSampleRate = 24000;
let currentSamplesPerFrame = 1920;
let currentLatentDim = 32;
let currentConditioningDim = 1024;
let currentMaxTokenPerChunk = 50;

let predefinedVoiceRecords = {};
let customVoiceEmbedding = null;
let currentVoiceName = null;
let voiceConditioningCache = new Map();

let stTensors = [];
let isGenerating = false;
let isReady = false;

function bundleDir(language) {
    return `${MODEL_BASE_URL}${language}`;
}

function bundlePath(language, filename) {
    return `${bundleDir(language)}/${filename}`;
}

function debugLog(...args) {
    if (DEBUG_LOGS) {
        console.log(...args);
    }
}

function makeFilledArray(shape, dtype, fill) {
    const size = shape.reduce((a, b) => a * b, 1);
    let data;

    if (dtype === "int64") {
        data = new BigInt64Array(size);
    } else if (dtype === "bool") {
        data = new Uint8Array(size);
    } else {
        data = new Float32Array(size);
        if (fill === "nan") {
            data.fill(NaN);
        } else if (fill === "ones") {
            data.fill(1);
        }
    }

    return data;
}

function createTensor(dtype, data, dims) {
    return new ort.Tensor(dtype, data, dims);
}

function initStateFromManifest(manifest) {
    const state = {};
    for (const entry of manifest) {
        state[entry.input_name] = createTensor(
            entry.dtype,
            makeFilledArray(entry.shape, entry.dtype, entry.fill),
            entry.shape
        );
    }
    return state;
}

function cloneState(state) {
    return { ...state };
}

function updateStateFromManifestOutputs(state, result, manifest) {
    for (const entry of manifest) {
        state[entry.input_name] = result[entry.output_name];
    }
}

function groupVoiceRecordByModule(record) {
    const grouped = {};
    for (const [key, value] of Object.entries(record)) {
        const slash = key.indexOf("/");
        if (slash === -1) continue;
        const moduleName = key.slice(0, slash);
        const tensorKey = key.slice(slash + 1);
        if (!grouped[moduleName]) {
            grouped[moduleName] = {};
        }
        grouped[moduleName][tensorKey] = value;
    }
    return grouped;
}

function adaptTypedArray(source, entry) {
    const targetShape = entry.shape;
    const targetSize = targetShape.reduce((a, b) => a * b, 1);
    const target = makeFilledArray(targetShape, entry.dtype, entry.fill);

    if (source.shape.length === targetShape.length) {
        const exactShape = source.shape.every((dim, idx) => dim === targetShape[idx]);
        if (exactShape) {
            if (entry.dtype === "int64") {
                return new BigInt64Array(source.data);
            }
            if (entry.dtype === "bool") {
                return new Uint8Array(source.data);
            }
            return new Float32Array(source.data);
        }
    }

    if (source.data.length === targetSize) {
        if (entry.dtype === "int64") {
            return new BigInt64Array(source.data);
        }
        if (entry.dtype === "bool") {
            return new Uint8Array(source.data);
        }
        return new Float32Array(source.data);
    }

    if (source.shape.length !== targetShape.length) {
        return target;
    }

    const strides = [];
    let stride = 1;
    for (let i = source.shape.length - 1; i >= 0; i--) {
        strides[i] = stride;
        stride *= source.shape[i];
    }

    const indices = new Array(source.shape.length).fill(0);
    const maxIndices = source.shape.map((dim, idx) => Math.min(dim, targetShape[idx]));

    function targetIndex(coords) {
        let idx = 0;
        let tStride = 1;
        for (let i = targetShape.length - 1; i >= 0; i--) {
            idx += coords[i] * tStride;
            tStride *= targetShape[i];
        }
        return idx;
    }

    let done = false;
    while (!done) {
        let sourceIdx = 0;
        for (let i = 0; i < indices.length; i++) {
            sourceIdx += indices[i] * strides[i];
        }
        target[targetIndex(indices)] = source.data[sourceIdx];

        for (let dim = indices.length - 1; dim >= 0; dim--) {
            indices[dim] += 1;
            if (indices[dim] < maxIndices[dim]) {
                break;
            }
            indices[dim] = 0;
            if (dim === 0) {
                done = true;
            }
        }
    }

    return target;
}

function deriveStep(moduleState) {
    if (moduleState.step) {
        return { data: BigInt64Array.from([BigInt(moduleState.step.data[0])]), shape: [1], dtype: "int64" };
    }
    if (moduleState.offset && !moduleState.end_offset) {
        return { data: BigInt64Array.from([BigInt(moduleState.offset.data[0])]), shape: [1], dtype: "int64" };
    }
    if (moduleState.current_end) {
        return { data: BigInt64Array.from([BigInt(moduleState.current_end.shape[0])]), shape: [1], dtype: "int64" };
    }
    return { data: BigInt64Array.from([0n]), shape: [1], dtype: "int64" };
}

function stateFromVoiceRecord(record) {
    const grouped = groupVoiceRecordByModule(record);
    const state = initStateFromManifest(bundleMetadata.flow_lm_state_manifest);

    for (const entry of bundleMetadata.flow_lm_state_manifest) {
        const moduleState = grouped[entry.module] || {};
        let source = moduleState[entry.key];
        if (!source && entry.key === "step") {
            source = deriveStep(moduleState);
        }
        if (!source) {
            continue;
        }

        const data = adaptTypedArray(source, entry);
        state[entry.input_name] = createTensor(entry.dtype, data, entry.shape);
    }

    return state;
}

function prepareVoiceEmbeddingData(voiceEmb) {
    let data = voiceEmb.data;
    let dims = voiceEmb.shape.slice();

    if (bundleMetadata.insert_bos_before_voice && bosBeforeVoice) {
        const bosData = bosBeforeVoice.data;
        const combined = new Float32Array(bosData.length + data.length);
        combined.set(bosData, 0);
        combined.set(data, bosData.length);
        data = combined;
        dims = [1, dims[1] + bosBeforeVoice.shape[1], dims[2]];
    }

    return createTensor("float32", data, dims);
}

async function buildVoiceConditionedState(voiceEmb) {
    const flowLmState = initStateFromManifest(bundleMetadata.flow_lm_state_manifest);
    const emptySeq = createTensor("float32", new Float32Array(0), [1, 0, currentLatentDim]);
    const voiceTensor = prepareVoiceEmbeddingData(voiceEmb);

    const result = await flowLmMainSession.run({
        sequence: emptySeq,
        text_embeddings: voiceTensor,
        ...flowLmState,
    });

    updateStateFromManifestOutputs(flowLmState, result, bundleMetadata.flow_lm_state_manifest);
    return flowLmState;
}

async function ensurePredefinedVoiceCached(voiceName, options = {}) {
    const { force = false, statusText = "Preparing voice..." } = options;
    if (!predefinedVoiceRecords[voiceName]) {
        throw new Error(`Unknown built-in voice: ${voiceName}`);
    }

    if (!force && voiceConditioningCache.has(voiceName)) {
        return voiceConditioningCache.get(voiceName);
    }

    postMessage({ type: "status", status: statusText, state: "loading" });
    const conditioned = stateFromVoiceRecord(predefinedVoiceRecords[voiceName]);
    voiceConditioningCache.set(voiceName, conditioned);
    return conditioned;
}

async function ensureCustomVoiceCached(options = {}) {
    const { force = false, statusText = "Preparing custom voice..." } = options;
    if (!customVoiceEmbedding) {
        throw new Error("No custom voice loaded.");
    }

    if (!force && voiceConditioningCache.has("custom")) {
        return voiceConditioningCache.get("custom");
    }

    postMessage({ type: "status", status: statusText, state: "loading" });
    const conditioned = await buildVoiceConditionedState(customVoiceEmbedding);
    voiceConditioningCache.set("custom", conditioned);
    return conditioned;
}

function parseNpyFloat32(buffer) {
    const view = new DataView(buffer);
    const magic = new Uint8Array(buffer, 0, 6);
    const expected = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
    for (let i = 0; i < expected.length; i++) {
        if (magic[i] !== expected[i]) {
            throw new Error("Invalid NPY file");
        }
    }

    const major = view.getUint8(6);
    const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
    const headerOffset = major === 1 ? 10 : 12;
    const headerText = new TextDecoder().decode(new Uint8Array(buffer, headerOffset, headerLen));
    const shapeMatch = headerText.match(/\(\s*([0-9,\s]+)\)/);
    if (!shapeMatch) {
        throw new Error("Could not parse NPY shape");
    }
    const shape = shapeMatch[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => Number.parseInt(part, 10));
    const dataOffset = headerOffset + headerLen;
    const data = new Float32Array(buffer, dataOffset);
    return { data: new Float32Array(data), shape };
}

function parseVoiceStatesBin(buffer) {
    const view = new DataView(buffer);
    let offset = 0;
    const magic = new TextDecoder().decode(new Uint8Array(buffer, offset, 5));
    offset += 5;
    if (magic !== "PTVB1") {
        throw new Error("Invalid voices.bin header");
    }

    const voices = {};
    const voiceCount = view.getUint32(offset, true);
    offset += 4;

    for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
        const nameLen = view.getUint16(offset, true);
        offset += 2;
        const name = new TextDecoder().decode(new Uint8Array(buffer, offset, nameLen));
        offset += nameLen;

        const tensorCount = view.getUint16(offset, true);
        offset += 2;
        const tensors = {};

        for (let tensorIndex = 0; tensorIndex < tensorCount; tensorIndex++) {
            const keyLen = view.getUint16(offset, true);
            offset += 2;
            const key = new TextDecoder().decode(new Uint8Array(buffer, offset, keyLen));
            offset += keyLen;

            const dtypeCode = view.getUint8(offset);
            offset += 1;
            const rank = view.getUint8(offset);
            offset += 1;

            const shape = [];
            for (let dimIndex = 0; dimIndex < rank; dimIndex++) {
                shape.push(view.getUint32(offset, true));
                offset += 4;
            }

            const byteLength = view.getUint32(offset, true);
            offset += 4;

            let data;
            if (dtypeCode === 0) {
                data = new Float32Array(buffer.slice(offset, offset + byteLength));
            } else if (dtypeCode === 1) {
                data = new BigInt64Array(buffer.slice(offset, offset + byteLength));
            } else if (dtypeCode === 2) {
                data = new Uint8Array(buffer.slice(offset, offset + byteLength));
            } else {
                throw new Error(`Unsupported voices.bin dtype code: ${dtypeCode}`);
            }
            offset += byteLength;

            tensors[key] = {
                data,
                shape,
                dtype: dtypeCode === 0 ? "float32" : dtypeCode === 1 ? "int64" : "bool",
            };
        }

        voices[name] = tensors;
    }

    return voices;
}

async function encodeVoiceAudio(audioData) {
    const input = createTensor("float32", audioData, [1, 1, audioData.length]);
    const outputs = await mimiEncoderSession.run({ audio: input });
    const embeddings = outputs[mimiEncoderSession.outputNames[0]];

    let dims = embeddings.dims.slice();
    let data = new Float32Array(embeddings.data);
    while (dims.length > 3) {
        if (dims[0] !== 1) break;
        dims = dims.slice(1);
    }
    if (dims.length < 3) {
        dims = [1, dims[0], dims[1]];
    }

    return { data, shape: dims };
}

function prepareTextPrompt(text) {
    let prompt = text.trim();
    if (!prompt) {
        return { text: "", framesAfterEos: 1 };
    }

    prompt = prompt.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ");
    if (bundleMetadata.remove_semicolons) {
        prompt = prompt.replace(/;/g, ",");
    }

    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    let framesAfterEos = wordCount <= 4 ? 3 : 1;
    if (bundleMetadata.model_recommended_frames_after_eos != null) {
        framesAfterEos = Number(bundleMetadata.model_recommended_frames_after_eos);
    }

    if (prompt && !/[A-ZÀ-Þ]/.test(prompt[0])) {
        prompt = prompt[0].toUpperCase() + prompt.slice(1);
    }
    if (prompt && /[0-9A-Za-zÀ-ÿ]/.test(prompt[prompt.length - 1])) {
        prompt += ".";
    }
    if (bundleMetadata.pad_with_spaces_for_short_inputs && wordCount < 5) {
        prompt = "        " + prompt;
    }

    return { text: prompt, framesAfterEos };
}

const SENTENCE_SPLIT_RE = /[^.!?]+[.!?]+|[^.!?]+$/g;

function splitTextIntoSentences(text) {
    const matches = text.match(SENTENCE_SPLIT_RE);
    if (!matches) return [];
    return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function splitTokenIdsIntoChunks(tokenIds, maxTokens) {
    const chunks = [];
    for (let i = 0; i < tokenIds.length; i += maxTokens) {
        const chunkText = tokenizerProcessor.decodeIds(tokenIds.slice(i, i + maxTokens)).trim();
        if (chunkText) {
            chunks.push(chunkText);
        }
    }
    return chunks;
}

// Cuts *after* a closing pause mark — comma, colon, semicolon, closing
// paren/bracket, curly closing quote, guillemet — never at an opening one.
// Straight ASCII '"' is deliberately excluded: it is the same glyph for open
// and close, so a single regex cannot tell them apart, and including it cuts
// right after the OPENING quote — worse than the raw-token fallback this
// function replaces. Verified by running this regex against a quoted clause:
// with '"' included, the split landed inside the quotation; without it, the
// whole quoted clause stays intact. Straight quotes surviving into narrated
// text is rare in practice — Gutenberg's RichText converts them to curly
// quotes as the author types, by default — and when one does survive, it
// falls through to the splitTokenIdsIntoChunks() fallback below, same as any
// clause with no usable pause point. No regression either way.
//
// This regex reads the RAW text on purpose, curly quote/paren included — it
// is the other half of the boundary tokenizer-sanitize.ts documents:
// splitting decisions use the real characters the author typed;
// sanitizeForTokenizer() only touches what gets handed to encodeIds().
// Normalizing here instead would erase this exact split signal.
const NATURAL_BREAK_RE = /[^,:;)\]”»]+[,:;)\]”»]+\s*|[^,:;)\]”»]+$/g;

// Returns clause descriptors — trimmed text plus the [start, end) span it came
// from in the ORIGINAL `text` — instead of just trimmed strings. The span is
// what lets splitSentenceAtNaturalBreaks() below reconstruct kept-together
// clauses by slicing the source text rather than rejoining trimmed fragments.
function splitIntoClauses(text) {
    const clauses = [];
    for (const match of text.matchAll(NATURAL_BREAK_RE)) {
        const trimmed = match[0].trim();
        if (!trimmed) continue;
        clauses.push({ text: trimmed, start: match.index, end: match.index + match[0].length });
    }
    return clauses;
}

// Same greedy-accumulation shape as the sentence-combining loop in
// splitIntoBestSentences below, one level down: pack pause-delimited clauses
// into a chunk until the next one would overflow, then start a new chunk.
// A single clause that overflows on its own (no internal pause) falls back to
// splitTokenIdsIntoChunks — the old raw-token cut — for that clause only; the
// rest of the sentence is unaffected.
function splitSentenceAtNaturalBreaks(sentenceText, maxTokens) {
    const clauses = splitIntoClauses(sentenceText);
    if (!clauses.length) {
        // Pathological case: the sentence has no character outside the pause
        // delimiter set (e.g. a run of only commas/brackets), so there is no
        // clause to split on. Fall back to the raw-token cut rather than
        // silently contributing nothing to the audio.
        return splitTokenIdsIntoChunks(tokenizerProcessor.encodeIds(sanitizeForTokenizer(sentenceText) || sentenceText), maxTokens);
    }

    const chunks = [];
    // Track the accumulated chunk by SPAN into sentenceText (start of its
    // first clause, end of its last), not by concatenating clause strings.
    let chunkStart = null;
    let chunkEnd = null;

    const flushChunk = () => {
        if (chunkStart === null) return;
        const chunkText = sentenceText.slice(chunkStart, chunkEnd).trim();
        if (chunkText) {
            chunks.push(chunkText);
        }
        chunkStart = null;
        chunkEnd = null;
    };

    for (const clause of clauses) {
        const clauseTokenIds = tokenizerProcessor.encodeIds(sanitizeForTokenizer(clause.text));

        if (clauseTokenIds.length > maxTokens) {
            flushChunk();
            for (const rawChunk of splitTokenIdsIntoChunks(clauseTokenIds, maxTokens)) {
                if (rawChunk) {
                    chunks.push(rawChunk.trim());
                }
            }
            continue;
        }

        if (chunkStart === null) {
            chunkStart = clause.start;
            chunkEnd = clause.end;
            continue;
        }

        // IMPORTANT: when a clause stays in the same chunk as the ones
        // before it, reconstruct the chunk by slicing sentenceText from
        // chunkStart to this clause's end — never by rejoining trimmed
        // clause strings with a literal " ". The clauses were trimmed only
        // so their length could be measured; the actual text between two
        // clauses (no space after a decimal comma, ": " after a time, "://"
        // in a URL) is whatever the author wrote, and a naive `${a} ${b}`
        // join inserts a space that was never there — e.g. "1,000" becomes
        // "1, 000", "10:30" becomes "10: 30". Only the two OUTER edges of a
        // finished chunk get trimmed, in flushChunk() above, because a real
        // cut happens there; internal joins never do.
        const candidateEnd = clause.end;
        const candidateText = sentenceText.slice(chunkStart, candidateEnd).trim();
        const candidateTokens = tokenizerProcessor.encodeIds(sanitizeForTokenizer(candidateText)).length;

        if (candidateTokens > maxTokens) {
            flushChunk();
            chunkStart = clause.start;
            chunkEnd = clause.end;
        } else {
            chunkEnd = candidateEnd;
        }
    }

    flushChunk();

    return chunks;
}

function splitIntoBestSentences(text) {
    const prepared = prepareTextPrompt(text);
    if (!prepared.text) {
        return { chunks: [], framesAfterEos: prepared.framesAfterEos };
    }

    const sentences = splitTextIntoSentences(prepared.text);
    if (!sentences.length) {
        return { chunks: [prepared.text], framesAfterEos: prepared.framesAfterEos };
    }

    const chunks = [];
    let currentChunk = "";

    for (const sentenceText of sentences) {
        const sentenceTokenIds = tokenizerProcessor.encodeIds(sanitizeForTokenizer(sentenceText));
        const sentenceTokens = sentenceTokenIds.length;

        if (sentenceTokens > currentMaxTokenPerChunk) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
            }
            const splitChunks = splitSentenceAtNaturalBreaks(sentenceText, currentMaxTokenPerChunk);
            for (const splitChunk of splitChunks) {
                if (splitChunk) {
                    chunks.push(splitChunk.trim());
                }
            }
            continue;
        }

        if (!currentChunk) {
            currentChunk = sentenceText;
            continue;
        }

        const combined = `${currentChunk} ${sentenceText}`;
        const combinedTokens = tokenizerProcessor.encodeIds(sanitizeForTokenizer(combined)).length;
        if (combinedTokens > currentMaxTokenPerChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = sentenceText;
        } else {
            currentChunk = combined;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return { chunks, framesAfterEos: prepared.framesAfterEos };
}

function precomputeFlowBuffers() {
    stTensors = [];
    const dt = 1.0 / LSD_STEPS;
    for (let step = 0; step < LSD_STEPS; step++) {
        const s = step / LSD_STEPS;
        const t = s + dt;
        stTensors.push({
            s: createTensor("float32", new Float32Array([s]), [1, 1]),
            t: createTensor("float32", new Float32Array([t]), [1, 1]),
        });
    }
}

async function loadOrt() {
    if (ort) {
        return;
    }

    postMessage({ type: "status", status: "Loading ONNX Runtime...", state: "loading" });
    const version = "1.20.0";
    const cdnBase = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
    // webpackIgnore keeps this a real runtime import of an absolute URL. ONNX
    // Runtime Web is loaded from a CDN on purpose (spec: not an npm dependency);
    // without the comment webpack tries to resolve the URL as a local path at
    // build time and fails with "Can't resolve 'https://cdn.jsdelivr.net/npm'".
    const ortModule = await import(/* webpackIgnore: true */ `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort.min.mjs`);
    ort = ortModule.default || ortModule;
    ort.env.wasm.wasmPaths = cdnBase;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(navigator.hardwareConcurrency || 4, 8)
        : 1;
    precomputeFlowBuffers();
}

async function releaseSession(session) {
    if (!session) {
        return;
    }
    if (typeof session.release === "function") {
        await session.release();
    }
}

async function loadBundle(language, { initialLoad = false } = {}) {
    if (!LANGUAGE_BUNDLES.includes(language)) {
        throw new Error(`Unsupported language bundle: ${language}`);
    }

    await loadOrt();

    postMessage({ type: "status", status: `Loading ${language} bundle...`, state: "loading" });
    currentLanguage = language;
    currentBundleDir = bundleDir(language);

    const metadataResponse = await fetch(bundlePath(language, "bundle.json"));
    if (!metadataResponse.ok) {
        throw new Error(`Failed to load bundle metadata for ${language}`);
    }
    bundleMetadata = await metadataResponse.json();

    currentSampleRate = Number(bundleMetadata.sample_rate);
    currentSamplesPerFrame = Number(bundleMetadata.samples_per_frame);
    currentLatentDim = Number(bundleMetadata.latent_dim);
    currentConditioningDim = Number(bundleMetadata.conditioning_dim);
    currentMaxTokenPerChunk = Number(bundleMetadata.max_token_per_chunk || 50);
    isReady = false;

    await Promise.all([
        releaseSession(mimiEncoderSession),
        releaseSession(textConditionerSession),
        releaseSession(flowLmMainSession),
        releaseSession(flowLmFlowSession),
        releaseSession(mimiDecoderSession),
    ]);

    const sessionOptions = {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
    };

    const [encoderRes, textCondRes, flowMainRes, flowFlowRes, decoderRes] = await Promise.all([
        ort.InferenceSession.create(bundlePath(language, MODEL_STEMS.mimi_encoder), sessionOptions),
        ort.InferenceSession.create(bundlePath(language, MODEL_STEMS.text_conditioner), sessionOptions),
        ort.InferenceSession.create(bundlePath(language, MODEL_STEMS.flow_lm_main), sessionOptions),
        ort.InferenceSession.create(bundlePath(language, MODEL_STEMS.flow_lm_flow), sessionOptions),
        ort.InferenceSession.create(bundlePath(language, MODEL_STEMS.mimi_decoder), sessionOptions),
    ]);

    mimiEncoderSession = encoderRes;
    textConditionerSession = textCondRes;
    flowLmMainSession = flowMainRes;
    flowLmFlowSession = flowFlowRes;
    mimiDecoderSession = decoderRes;

    const tokenizerResponse = await fetch(bundlePath(language, bundleMetadata.tokenizer_file));
    if (!tokenizerResponse.ok) {
        throw new Error(`Failed to load tokenizer for ${language}`);
    }
    const tokenizerBuffer = await tokenizerResponse.arrayBuffer();
    tokenizerModelB64 = btoa(String.fromCharCode(...new Uint8Array(tokenizerBuffer)));
    const spModule = await import("./sentencepiece.js");
    tokenizerProcessor = new spModule.SentencePieceProcessor();
    await tokenizerProcessor.loadFromB64StringModel(tokenizerModelB64);

    bosBeforeVoice = null;
    if (bundleMetadata.bos_before_voice_file) {
        const bosResponse = await fetch(bundlePath(language, bundleMetadata.bos_before_voice_file));
        if (bosResponse.ok) {
            bosBeforeVoice = parseNpyFloat32(await bosResponse.arrayBuffer());
        }
    }

    predefinedVoiceRecords = {};
    const voicesResponse = await fetch(bundlePath(language, "voices.bin"));
    if (voicesResponse.ok) {
        predefinedVoiceRecords = parseVoiceStatesBin(await voicesResponse.arrayBuffer());
    }

    voiceConditioningCache = new Map();
    let defaultVoice = bundleMetadata.predefined_voices?.includes("alba") ? "alba" : null;
    if (!defaultVoice) {
        defaultVoice = Object.keys(predefinedVoiceRecords)[0] || null;
    }
    currentVoiceName = defaultVoice;

    if (defaultVoice) {
        await ensurePredefinedVoiceCached(defaultVoice, {
            force: true,
            statusText: `Preparing voice (${defaultVoice})...`,
        });
    }

    if (customVoiceEmbedding) {
        voiceConditioningCache.delete("custom");
    }

    isReady = true;

    postMessage({
        type: "voices_loaded",
        voices: bundleMetadata.predefined_voices || Object.keys(predefinedVoiceRecords),
        defaultVoice,
        language,
    });
    postMessage({
        type: "bundle_loaded",
        language,
        sampleRate: currentSampleRate,
        initialLoad,
    });
    postMessage({ type: "status", status: "Ready", state: "idle" });
    postMessage({ type: "model_status", status: "ready", text: `Ready (${language})` });
    if (initialLoad) {
        postMessage({ type: "loaded" });
    }
}

self.onmessage = async (e) => {
    const { type, data } = e.data;

    try {
        if (type === "load") {
            await loadBundle(DEFAULT_LANGUAGE, { initialLoad: true });
            return;
        }

        if (type === "set_language") {
            if (isGenerating) {
                postMessage({ type: "error", error: "Cannot switch language while generation is running." });
                return;
            }
            await loadBundle(data.language, { initialLoad: false });
            return;
        }

        if (type === "stop") {
            isGenerating = false;
            postMessage({ type: "status", status: "Stopped", state: "idle" });
            return;
        }

        if (!isReady) {
            postMessage({ type: "error", error: "Models are not loaded yet." });
            return;
        }

        if (type === "encode_voice") {
            if (isGenerating) {
                postMessage({ type: "error", error: "Cannot encode a voice while generation is running." });
                return;
            }
            customVoiceEmbedding = await encodeVoiceAudio(data.audio);
            currentVoiceName = "custom";
            await ensureCustomVoiceCached({ force: true, statusText: "Preparing custom voice..." });
            postMessage({ type: "voice_encoded", voiceName: "custom" });
            postMessage({ type: "status", status: "Ready", state: "idle" });
            return;
        }

        if (type === "set_voice") {
            if (isGenerating) {
                postMessage({ type: "error", error: "Cannot switch voice while generation is running." });
                return;
            }
            if (data.voiceName === "custom") {
                await ensureCustomVoiceCached({ statusText: "Preparing custom voice..." });
                currentVoiceName = "custom";
            } else {
                await ensurePredefinedVoiceCached(data.voiceName, {
                    statusText: `Preparing voice (${data.voiceName})...`,
                });
                currentVoiceName = data.voiceName;
            }
            postMessage({ type: "voice_set", voiceName: currentVoiceName });
            postMessage({ type: "status", status: "Ready", state: "idle" });
            return;
        }

        if (type === "generate") {
            if (isGenerating) {
                return;
            }
            await startGeneration(data.text, data.voice || currentVoiceName);
        }
    } catch (err) {
        console.error("Worker error:", err);
        postMessage({ type: "error", error: err.toString() });
    }
};

async function startGeneration(text, voiceName) {
    isGenerating = true;
    postMessage({ type: "status", status: "Generating...", state: "running" });
    postMessage({ type: "generation_started", data: { time: performance.now() } });

    try {
        const { chunks, framesAfterEos } = splitIntoBestSentences(text);
        if (!chunks.length) {
            throw new Error("No text to generate");
        }

        if (voiceName === "custom") {
            await ensureCustomVoiceCached({ statusText: "Preparing custom voice..." });
        } else {
            await ensurePredefinedVoiceCached(voiceName, {
                statusText: `Preparing voice (${voiceName})...`,
            });
        }
        currentVoiceName = voiceName;

        await runGenerationPipeline(voiceName, chunks, framesAfterEos);
    } catch (err) {
        console.error("Generation error:", err);
        postMessage({ type: "error", error: err.toString() });
    } finally {
        if (isGenerating) {
            postMessage({ type: "stream_ended" });
            postMessage({ type: "status", status: "Finished", state: "idle" });
        }
        isGenerating = false;
    }
}

async function runGenerationPipeline(voiceName, chunks, framesAfterEos) {
    const mimiState = initStateFromManifest(bundleMetadata.mimi_state_manifest);
    const emptySeq = createTensor("float32", new Float32Array(0), [1, 0, currentLatentDim]);
    const emptyTextEmb = createTensor("float32", new Float32Array(0), [1, 0, currentConditioningDim]);
    const baseFlowState = voiceConditioningCache.get(voiceName);
    if (!baseFlowState) {
        throw new Error(`Voice conditioning cache missing for '${voiceName}'.`);
    }
    let flowLmState = cloneState(baseFlowState);

    const firstChunkFrames = 3;
    const normalChunkFrames = 12;
    const allGeneratedLatents = [];
    let isFirstAudioChunk = true;
    let totalFlowLmTime = 0;
    let totalDecodeTime = 0;
    const generationStart = performance.now();

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (!isGenerating) break;

        // flowLmState resets to the segment's base voice conditioning at every
        // internal chunk boundary. This looks like it throws away exactly what
        // Task 1 set out to preserve, but it isn't optional: eos_logit (below)
        // is a function of this same carried state, and the model was not
        // trained to keep speaking past its own EOS signal within one context.
        // Carrying flowLmState across chunks was tried and reverted — see
        // docs/superpowers/specs/2026-08-18-narration-audio-quality-chunking-design.md
        // for the investigation (issue #5 follow-up) and why it doesn't hold on
        // this exported bundle. mimiState (the audio decoder, no EOS decision
        // reads it) still carries over below, which is what CHUNK_GAP_SEC's
        // smaller value is actually buying.
        if (chunkIdx > 0) {
            flowLmState = cloneState(baseFlowState);
        }

        const chunkText = chunks[chunkIdx];
        let isFirstAudioChunkOfTextChunk = true;
        const tokenIds = tokenizerProcessor.encodeIds(sanitizeForTokenizer(chunkText) || chunkText);
        const textInput = createTensor(
            "int64",
            BigInt64Array.from(tokenIds.map((token) => BigInt(token))),
            [1, tokenIds.length]
        );

        let textEmb = (await textConditionerSession.run({ token_ids: textInput }))[textConditionerSession.outputNames[0]];
        if (textEmb.dims.length === 2) {
            textEmb = createTensor("float32", new Float32Array(textEmb.data), [1, textEmb.dims[0], textEmb.dims[1]]);
        }

        const condResult = await flowLmMainSession.run({
            sequence: emptySeq,
            text_embeddings: textEmb,
            ...flowLmState,
        });
        updateStateFromManifestOutputs(flowLmState, condResult, bundleMetadata.flow_lm_state_manifest);

        const chunkLatents = [];
        let chunkDecodedFrames = 0;
        let currentLatent = createTensor("float32", new Float32Array(currentLatentDim).fill(NaN), [1, 1, currentLatentDim]);
        let eosStep = null;
        let chunkEnded = false;
        let chunkGenTimeMs = 0;

        for (let step = 0; step < MAX_FRAMES; step++) {
            if (!isGenerating) break;
            if (step > 0 && step % 4 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            const stepStart = performance.now();
            const arResult = await flowLmMainSession.run({
                sequence: currentLatent,
                text_embeddings: emptyTextEmb,
                ...flowLmState,
            });
            const stepElapsed = performance.now() - stepStart;
            chunkGenTimeMs += stepElapsed;
            totalFlowLmTime += stepElapsed;

            const conditioning = arResult.conditioning;
            const eosLogit = arResult.eos_logit.data[0];
            const isEos = eosLogit > -4.0;
            if (isEos && eosStep == null) {
                eosStep = step;
            }
            const shouldStop = eosStep != null && step >= eosStep + framesAfterEos;

            const temperature = 0.7;
            const std = Math.sqrt(temperature);
            const latentData = new Float32Array(currentLatentDim);
            for (let i = 0; i < currentLatentDim; i++) {
                let u = 0;
                let v = 0;
                while (u === 0) u = Math.random();
                while (v === 0) v = Math.random();
                latentData[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * std;
            }

            const dt = 1.0 / LSD_STEPS;
            for (let lsdIndex = 0; lsdIndex < LSD_STEPS; lsdIndex++) {
                const flowResult = await flowLmFlowSession.run({
                    c: conditioning,
                    s: stTensors[lsdIndex].s,
                    t: stTensors[lsdIndex].t,
                    x: createTensor("float32", latentData, [1, currentLatentDim]),
                });
                const flowDir = flowResult.flow_dir.data;
                for (let i = 0; i < currentLatentDim; i++) {
                    latentData[i] += flowDir[i] * dt;
                }
            }

            chunkLatents.push(new Float32Array(latentData));
            allGeneratedLatents.push(new Float32Array(latentData));
            currentLatent = createTensor("float32", latentData, [1, 1, currentLatentDim]);
            updateStateFromManifestOutputs(flowLmState, arResult, bundleMetadata.flow_lm_state_manifest);

            const pending = chunkLatents.length - chunkDecodedFrames;
            let decodeSize = 0;
            if (shouldStop) {
                decodeSize = pending;
            } else if (isFirstAudioChunk && pending >= firstChunkFrames) {
                decodeSize = firstChunkFrames;
            } else if (pending >= normalChunkFrames) {
                decodeSize = normalChunkFrames;
            }

            if (decodeSize > 0) {
                const decodeLatents = new Float32Array(decodeSize * currentLatentDim);
                for (let frame = 0; frame < decodeSize; frame++) {
                    decodeLatents.set(chunkLatents[chunkDecodedFrames + frame], frame * currentLatentDim);
                }

                const decoderStart = performance.now();
                const decodeResult = await mimiDecoderSession.run({
                    latent: createTensor("float32", decodeLatents, [1, decodeSize, currentLatentDim]),
                    ...mimiState,
                });
                const decoderElapsed = performance.now() - decoderStart;
                chunkGenTimeMs += decoderElapsed;
                totalDecodeTime += decoderElapsed;

                for (const entry of bundleMetadata.mimi_state_manifest) {
                    mimiState[entry.input_name] = decodeResult[entry.output_name];
                }

                chunkDecodedFrames += decodeSize;
                const audioFloat32 = new Float32Array(decodeResult[mimiDecoderSession.outputNames[0]].data);
                const isLastChunk = shouldStop && chunkIdx === chunks.length - 1;

                postMessage({
                    type: "audio_chunk",
                    data: audioFloat32,
                    metrics: {
                        bbTime: 0,
                        decTime: 0,
                        chunkDuration: audioFloat32.length / currentSampleRate,
                        genTimeSec: chunkGenTimeMs / 1000,
                        isFirst: isFirstAudioChunk,
                        isLast: isLastChunk,
                        chunkStart: isFirstAudioChunkOfTextChunk,
                    },
                }, [audioFloat32.buffer]);

                isFirstAudioChunk = false;
                isFirstAudioChunkOfTextChunk = false;
                chunkGenTimeMs = 0;
            }

            if (shouldStop) {
                chunkEnded = true;
                break;
            }
        }

        if (chunkEnded && isGenerating && chunkIdx < chunks.length - 1) {
            const gapSamples = Math.max(1, Math.floor(CHUNK_GAP_SEC * currentSampleRate));
            const silence = new Float32Array(gapSamples);
            postMessage({
                type: "audio_chunk",
                data: silence,
                metrics: {
                    bbTime: 0,
                    decTime: 0,
                    chunkDuration: gapSamples / currentSampleRate,
                    isFirst: false,
                    isLast: false,
                    isSilence: true,
                },
            }, [silence.buffer]);
        }
    }

    const totalTime = (performance.now() - generationStart) / 1000;
    const audioSeconds = allGeneratedLatents.length * currentSamplesPerFrame / currentSampleRate;
    const genTime = (totalFlowLmTime + totalDecodeTime) / 1000;
    const rtfx = genTime > 0 ? audioSeconds / genTime : 0;

    debugLog(`Generation complete for ${voiceName} in ${totalTime.toFixed(2)}s (RTFx ${rtfx.toFixed(2)}x)`);
    postMessage({
        type: "status",
        status: `Finished (RTFx: ${rtfx.toFixed(2)}x)`,
        state: "idle",
        metrics: { rtfx, genTime, totalTime, audioDuration: audioSeconds },
    });
}
