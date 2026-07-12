import os
import re
import json

textbooks_dir = "textbooks"
output_file = "chunks.json"

def clean_text(text):
    # Remove page markers we added ourselves
    text = re.sub(r"--- Page \d+ ---", "", text)
    # Collapse multiple blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def chunk_text(text, max_words=250):
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []
    current_chunk = ""
    
    for para in paragraphs:
        if len(current_chunk.split()) + len(para.split()) > max_words and current_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = para
        else:
            current_chunk += "\n\n" + para
    
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks

all_chunks = []
chunk_id = 1

txt_files = [f for f in os.listdir(textbooks_dir) if f.endswith("_extracted.txt")]

for txt_file in sorted(txt_files):
    chapter_name = txt_file.replace("_extracted.txt", "")
    filepath = os.path.join(textbooks_dir, txt_file)
    
    with open(filepath, "r", encoding="utf-8") as f:
        raw_text = f.read()
    
    cleaned = clean_text(raw_text)
    chunks = chunk_text(cleaned)
    
    for chunk in chunks:
        all_chunks.append({
            "id": chunk_id,
            "chapter": chapter_name,
            "text": chunk,
            "word_count": len(chunk.split())
        })
        chunk_id += 1
    
    print(f"{chapter_name}: {len(chunks)} chunks")

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(all_chunks, f, ensure_ascii=False, indent=2)

print(f"\nTotal chunks: {len(all_chunks)}")
print(f"Saved to {output_file}")