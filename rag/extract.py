import fitz
import pytesseract
from PIL import Image
import io

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

pdf_path = "textbooks/Chapter_1_Digestive_System_of_Man.pdf"
doc = fitz.open(pdf_path)

print(f"Processing {len(doc)} pages... this will take a few minutes.")

full_text = ""

for i in range(len(doc)):
    page = doc[i]
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    img_data = pix.tobytes("png")
    img = Image.open(io.BytesIO(img_data))
    
    text = pytesseract.image_to_string(img)
    full_text += f"\n\n--- Page {i+1} ---\n\n{text}"
    
    print(f"Page {i+1}/{len(doc)} done")

# Save to a text file
output_path = "textbooks/chapter1_extracted.txt"
with open(output_path, "w", encoding="utf-8") as f:
    f.write(full_text)

print(f"\nDone! Saved to {output_path}")