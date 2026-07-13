import json
from sentence_transformers import SentenceTransformer
import numpy as np

print("Loading embedding model...")
model = SentenceTransformer("all-MiniLM-L6-v2")

print("Loading chunks...")
with open("chunks_with_embeddings.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

# Convert all chunk embeddings into a single matrix for fast comparison
chunk_embeddings = np.array([chunk["embedding"] for chunk in chunks])

def search(query, top_k=3):
    query_embedding = model.encode([query])[0]
    
    # Cosine similarity between the query and every chunk
    similarities = np.dot(chunk_embeddings, query_embedding) / (
        np.linalg.norm(chunk_embeddings, axis=1) * np.linalg.norm(query_embedding)
    )
    
    # Get indices of the top_k most similar chunks
    top_indices = np.argsort(similarities)[::-1][:top_k]
    
    results = []
    for idx in top_indices:
        results.append({
            "chapter": chunks[idx]["chapter"],
            "text": chunks[idx]["text"],
            "score": float(similarities[idx])
        })
    return results

# Interactive loop - type questions, get results
print("\nReady! Type a Biology question (or 'quit' to exit):\n")

while True:
    query = input("Question: ")
    if query.lower() in ["quit", "exit"]:
        break
    
    results = search(query)
    print(f"\nTop {len(results)} relevant chunks:\n")
    for i, r in enumerate(results, 1):
        print(f"--- Result {i} (chapter: {r['chapter']}, score: {r['score']:.3f}) ---")
        print(r["text"][:300])
        print()