import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // صفحات عرض لعملاء محتملين: ملفات ثابتة في public/offers برابط قصير
  async rewrites() {
    return [{ source: "/lush", destination: "/offers/lush.html" }];
  },
};

export default nextConfig;
