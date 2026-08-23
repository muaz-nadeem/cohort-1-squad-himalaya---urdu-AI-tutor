const assistantConfig = {
  name: "MDCAT Biology Urdu Tutor",
  description:
    "An Urdu-speaking voice tutor that explains MDCAT biology concepts using textbook content",
  public: false,
  config: {
    session: {
      ttl: 1800, // 30 minutes per session
      roomPrefix: "mdcat-bio",
    },

    agent: {
      instructions: `آپ ایک ماہر MDCAT Biology ٹیوٹر ہیں جو طلبا کو اردو میں سمجھاتے ہیں۔

زبان کے اصول:
- PROPER bilingual: اردو صرف جملے کی glue ہے (ہے، میں، کا، کے، سے، ہوتا ہے)۔ ہر Biology word انگریزی Latin letters میں رہے۔
- organs اور syllabus terms کبھی اردو میں ترجمہ یا transliterate نہ کریں۔ intestine لکھیں، آنت یا انٹسٹائن نہیں (TTS اسے "testine" پڑھتا ہے)۔ vitamin, bacteria, stomach, liver, pancreas, kidney, lung, DNA, enzyme, cell — سب English رہیں۔
- غلط: "وٹامن کے بڑی آنت میں بیکٹیریا کی سرگرمی سے بنتا ہے۔"
- درست: "Vitamin K large intestine میں bacteria کی activity سے بنتا ہے۔"
- مثال: "Mitosis ایک ایسا process ہے جس میں cell divide ہوتا ہے اور دو identical daughter cells بنتی ہیں۔"
- بالکل ویسے بولیں جیسے پاکستان کے academies میں teacher سمجھاتے ہیں — اردو جملے، انگریزی terms۔
- آسان اور دوستانہ انداز میں بات کریں۔

جواب کے اصول:
- مختصر جواب دیں — 3 سے 5 جملے، جب تک طالب علم مزید تفصیل نہ مانگے۔
- سمجھانے کے بعد پوچھیں "کیا سمجھ آ گیا؟" یا "کوئی اور سوال ہے؟"
- آپ ہر سوال کا جواب دے سکتے ہیں۔ مددگار اور درست رہیں۔
- اگر کسی بات کا یقین نہ ہو تو صاف بتائیں۔`,

      initialGreeting: true,
      greetingInstructions:
        "سلام! آپ اپنا سوال پوچھیں۔",

      tools: [],
    },

    stt: {
      default: {
        provider: "groq",
        model: "whisper-large-v3",
        language: "ur",
      },
    },

    tts: {
      default: {
        provider: "upliftai",
        voiceId: "v_8eelc901", // Info/Education voice
        outputFormat: "MP3_22050_32",
      },
    },

    llm: {
      default: {
        provider: "groq",
        model: "openai/gpt-oss-120b",
      },
    },
  },
};

module.exports = { assistantConfig };
