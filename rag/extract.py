import fitz
import pytesseract
from PIL import Image
import io
import os

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

textbooks_dir = "textbooks"

pdf_files = [f for f in os.listdir(textbooks_dir) if f.endswith(".pdf")]
print(f"Found {len(pdf_files)} PDF files to process.\n")

for pdf_file in pdf_files:
    pdf_path = os.path.join(textbooks_dir, pdf_file)
    output_name = pdf_file.replace(".pdf", "_extracted.txt")
    output_path = os.path.join(textbooks_dir, output_name)

    # Skip if already processed
    if os.path.exists(output_path):
        print(f"Skipping {pdf_file} (already done)")
        continue

    print(f"Processing {pdf_file} ...")
    doc = fitz.open(pdf_path)
    full_text = ""

    for i in range(len(doc)):
        page = doc[i]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_data = pix.tobytes("png")
        img = Image.open(io.BytesIO(img_data))
        text = pytesseract.image_to_string(img)
        full_text += f"\n\n--- Page {i+1} ---\n\n{text}"

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(full_text)

    print(f"  Done: {output_path} ({len(doc)} pages)\n")

print("All chapters processed!")