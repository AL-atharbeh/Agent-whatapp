import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * أصوات عربية من مكتبة ElevenLabs لاختيار صوت متجر — GET ?gender=&accent=&search=&page=
 *
 * العيّنات روابط preview_url عامة من المكتبة نفسها: الاستماع لا يخصم من
 * الرصيد، خلافاً لتوليد عيّنة بنص المتجر (voice-preview).
 * لمالك المنصة وحده — المفتاح مفتاح المنصة.
 */

export type LibraryVoice = {
  id: string;
  ownerId: string | null;
  name: string;
  gender: string | null;
  accent: string | null;
  age: string | null;
  description: string | null;
  previewUrl: string | null;
  uses: number;
  inAccount: boolean;
};

type Raw = {
  voice_id: string;
  public_owner_id?: string;
  name?: string;
  gender?: string;
  accent?: string;
  age?: string;
  description?: string;
  preview_url?: string;
  cloned_by_count?: number;
  verified_languages?: { language?: string; accent?: string; preview_url?: string }[];
};

export async function GET(req: Request) {
  const session = await getSession();
  if (session?.role !== "PLATFORM_ADMIN") return Response.json({ error: "forbidden" }, { status: 403 });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "أضف ELEVENLABS_API_KEY في إعدادات الخادم" }, { status: 501 });

  const u = new URL(req.url);
  const q = new URLSearchParams({ language: "ar", page_size: "30", sort: "cloned_by_count" });
  for (const p of ["gender", "accent", "search", "page"] as const) {
    const v = u.searchParams.get(p)?.trim();
    if (v) q.set(p, v.slice(0, 40));
  }
  const headers = { "xi-api-key": key };

  const [shared, mine] = await Promise.all([
    fetch(`https://api.elevenlabs.io/v1/shared-voices?${q}`, { headers }),
    fetch("https://api.elevenlabs.io/v1/voices", { headers }),
  ]);
  if (!shared.ok) {
    console.error("[voices]", shared.status, await shared.text());
    return Response.json({ error: "تعذّر جلب الأصوات من ElevenLabs — تحقّق من صلاحية Voices في المفتاح" }, { status: 502 });
  }
  const data = (await shared.json()) as { voices?: Raw[]; has_more?: boolean };
  const own = mine.ok ? ((await mine.json()) as { voices?: { voice_id: string }[] }).voices ?? [] : [];
  const ownIds = new Set(own.map((v) => v.voice_id));

  const voices: LibraryVoice[] = (data.voices ?? []).map((v) => {
    // عيّنة عربية إن وُجدت — preview_url العام قد يكون بلغة أخرى للصوت نفسه
    const ar = v.verified_languages?.find((l) => l.language === "ar" && l.preview_url);
    return {
      id: v.voice_id,
      ownerId: v.public_owner_id ?? null,
      name: v.name ?? v.voice_id,
      gender: v.gender ?? null,
      accent: ar?.accent ?? v.accent ?? null,
      age: v.age ?? null,
      description: v.description ? v.description.slice(0, 160) : null,
      previewUrl: ar?.preview_url ?? v.preview_url ?? null,
      uses: v.cloned_by_count ?? 0,
      inAccount: ownIds.has(v.voice_id),
    };
  });
  return Response.json({ voices, hasMore: !!data.has_more });
}
