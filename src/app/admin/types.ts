export const BUSINESS_TYPES = [
  { value: "gold", label: "ذهب ومجوهرات" },
  { value: "clothing", label: "ملابس" },
  { value: "restaurant", label: "مطعم" },
  { value: "pharmacy", label: "صيدلية" },
  { value: "clinic", label: "عيادة" },
  { value: "realestate", label: "عقارات" },
  { value: "other", label: "أخرى" },
] as const;

export const PRICE_UNITS = [
  { value: "piece", label: "للقطعة" },
  { value: "gram", label: "للجرام" },
  { value: "kg", label: "للكيلو" },
  { value: "hour", label: "للساعة" },
  { value: "night", label: "لليلة" },
] as const;

export const CHANNELS = [
  { value: "WHATSAPP", label: "واتساب" },
  { value: "MESSENGER", label: "ماسنجر" },
  { value: "INSTAGRAM", label: "انستقرام" },
] as const;

/** أمثلة خصائص جاهزة حسب نوع النشاط — تظهر كتلميح في نموذج المنتج. */
export const ATTRIBUTE_EXAMPLES: Record<string, string> = {
  gold: '{"karat": 21, "weight_g": 4.2, "workmanship_per_g": 4}',
  clothing: '{"sizes": ["S","M","L"], "colors": ["أزرق","أسود"]}',
  restaurant: '{"spicy": false, "serves": 2}',
  pharmacy: '{"requires_prescription": false}',
  realestate: '{"rooms": 3, "area_m2": 140, "floor": 2}',
};
