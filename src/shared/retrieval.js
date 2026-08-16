// PRD Phase 2: retrieve_context's implementation. Chunks the CV/cover-letter
// corpus into paragraphs, embeds them, and does in-memory cosine-similarity
// search - no vector DB, because at this corpus size (a handful of
// documents) one isn't earning its keep, and an in-memory array is more
// honest about the actual scale of the problem.
//
// Embeddings: Voyage AI, Anthropic's recommended embeddings provider for use
// alongside Claude. If VOYAGE_API_KEY isn't set, this falls back to a crude
// word-overlap score instead of failing outright - retrieval quality is
// noticeably worse, but the whole pipeline still runs end to end with only
// an ANTHROPIC_API_KEY configured.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = path.join(__dirname, "..", "..", "context");
const EXAMPLE_DIR = path.join(CONTEXT_DIR, "example");

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const EMBED_MODEL = "voyage-3.5";

let cachedChunks = null; // built once per process, on first retrieveContext() call

async function readTextFile(filePath) {
  if (filePath.toLowerCase().endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value;
  }
  return fs.readFileSync(filePath, "utf-8");
}

function chunkText(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20); // drop stray short lines/headers
}

async function loadCorpus() {
  // Excludes README.md - it documents this directory, it isn't corpus content.
  const isSourceFile = (f) => /\.(md|txt|docx)$/i.test(f) && f.toLowerCase() !== "readme.md";

  let dir = CONTEXT_DIR;
  let files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(isSourceFile) : [];

  if (files.length === 0) {
    dir = EXAMPLE_DIR;
    files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(isSourceFile) : [];
    if (files.length > 0) {
      console.warn(
        "[retrieval] No real CV/cover-letter files found directly in context/ - using the fake " +
          "example corpus in context/example/. Drop your real files (.md, .txt, or .docx) directly " +
          "in context/ to ground drafts in your actual experience."
      );
    }
  }

  const chunks = [];
  for (const file of files) {
    const text = await readTextFile(path.join(dir, file));
    for (const chunkedText of chunkText(text)) {
      chunks.push({ text: chunkedText, source: file });
    }
  }
  return chunks;
}

async function embed(texts) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model: EMBED_MODEL }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embeddings request failed: ${res.status} ${await res.text()}`);
  }
  const { data } = await res.json();
  return data.map((d) => d.embedding);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// No embeddings API configured: word-overlap, not semantic similarity - good
// enough to keep the pipeline runnable, not a substitute for real embeddings.
function lexicalScore(query, text) {
  const words = (s) => new Set((s.toLowerCase().match(/[a-z0-9]+/g)) || []);
  const q = words(query);
  const t = words(text);
  if (q.size === 0 || t.size === 0) return 0;
  let overlap = 0;
  for (const w of q) if (t.has(w)) overlap++;
  return overlap / q.size;
}

async function getCorpus() {
  if (cachedChunks) return cachedChunks;

  const chunks = await loadCorpus();
  if (chunks.length === 0) {
    cachedChunks = [];
    return cachedChunks;
  }

  if (VOYAGE_API_KEY) {
    const embeddings = await embed(chunks.map((c) => c.text));
    cachedChunks = chunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  } else {
    console.warn(
      "[retrieval] VOYAGE_API_KEY not set - falling back to word-overlap matching instead of real " +
        "embeddings. Retrieval quality will be noticeably worse; set VOYAGE_API_KEY for real semantic search."
    );
    cachedChunks = chunks;
  }
  return cachedChunks;
}

export async function retrieveContext(query, topN = 4) {
  const chunks = await getCorpus();
  if (chunks.length === 0) {
    return { chunks: [], note: "No CV/cover-letter context available - context/ is empty." };
  }

  let scored;
  if (VOYAGE_API_KEY) {
    const [queryEmbedding] = await embed([query]);
    scored = chunks.map((c) => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }));
  } else {
    scored = chunks.map((c) => ({ ...c, score: lexicalScore(query, c.text) }));
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    chunks: scored.slice(0, topN).map(({ text, source, score }) => ({
      text,
      source,
      score: Number(score.toFixed(3)),
    })),
  };
}
