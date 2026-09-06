// تطبيع النص العربي لتحسين البحث في الكتالوج.
// العميل يكتب "فستان ازرق" والمنتج مخزّن "فُستان أزرق" — بدون تطبيع لا يتطابقان.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeArabic(input: string): string {
  return input
    .toLowerCase()
    .replace(DIACRITICS, "") // تشكيل + تطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // أرقام عربية
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** يقسّم استعلام المستخدم لكلمات مفيدة (يتجاهل حروف الجر والكلمات القصيرة). */
const STOPWORDS = new Set([
  "في","من","على","عن","الى","إلى","هل","كم","ما","هو","هي","انا","أنا",
  "بدي","بدنا","ابغى","أبغى","عندكم","عندك","في","يوجد","متوفر","سعر","بكم",
  "the","a","an","is","are","how","much","do","you","have",
]);

export function searchTerms(query: string): string[] {
  return normalizeArabic(query)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .slice(0, 8);
}
