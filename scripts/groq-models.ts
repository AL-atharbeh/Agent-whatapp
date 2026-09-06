/** يعرض النماذج المتاحة فعلياً على حسابك في Groq. شغّله بـ: npx tsx scripts/groq-models.ts */

async function main() {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.error("GROQ_API_KEY غير موجود في .env");
    return;
  }

  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!res.ok) {
    console.error(`فشل: ${res.status} — ${await res.text()}`);
    return;
  }

  const { data } = (await res.json()) as { data: { id: string; context_window?: number }[] };
  console.log("\nالنماذج المتاحة على حسابك:\n");
  for (const m of data.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${m.id}${m.context_window ? `  (سياق ${m.context_window})` : ""}`);
  }
  console.log("\nضع المختار في .env تحت GROQ_MODEL\n");
}

main().catch(console.error);
