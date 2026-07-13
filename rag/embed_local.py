import json
import os
from sentence_transformers import SentenceTransformer

# Load chunks
with open("chunks.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

print(f"Loaded {len(chunks)} chunks.")
print("Loading embedding model (first run downloads it, ~80MB)...")

# A small, fast, good-quality free model
model = SentenceTransformer("all-MiniLM-L6-v2")

output_file = "chunks_with_embeddings.json"

print("Generating embeddings...")

texts = [chunk["text"] for chunk in chunks]

# Encode all at once - much faster than one-by-one, shows a progress bar
embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)

result = []
for chunk, embedding in zip(chunks, embeddings):
    chunk_with_embedding = dict(chunk)
    chunk_with_embedding["embedding"] = embedding.tolist()
    result.append(chunk_with_embedding)

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(result, f)

print(f"\nDone! {len(result)} chunks embedded and saved to {output_file}")